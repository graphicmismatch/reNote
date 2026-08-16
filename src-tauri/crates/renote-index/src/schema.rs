//! DDL for the per-notebook index database, plus the open/version-check
//! logic that implements the plan's "schema-version mismatch -> drop and
//! rebuild" migration strategy for this crate (deliberately simpler than
//! `renote-storage`'s real versioned page migration: the index holds no
//! unrecoverable data, so dropping and rescanning is always safe and
//! correct, never a data-loss risk).
//!
//! ## Schema
//! One `.sqlite` file per notebook, at `<notebook-dir>/.renote-index/index.sqlite`:
//! - `section_group` / `section` / `page`: enough structural metadata to
//!   reconstruct navigation (id, parent relationships, name/title,
//!   order_key, timestamps), each row also carrying an absolute `dir_path`
//!   (or `section_dir` for pages) so the command layer can resolve a
//!   notebook/section/page id straight to a filesystem path without a
//!   separate recursive folder walk on every request.
//! - `page_fts`: an FTS5 virtual table over page titles + extracted plain
//!   text (see `crate::page_index::extract_plain_text`), used by
//!   `crate::search`.
//! - `tag`: one row per notebook-scoped `Tag` definition (id, kind, label,
//!   color), populated once per notebook (not per page) — see
//!   `crate::page_index::index_tags`.
//! - `paragraph_tag`: one row per (page, object, paragraph-index) tuple
//!   whose rich-text paragraph carries a non-null `tagId`, extracted during
//!   the same walk as `page_fts` — see `crate::page_index::index_page`. Carries the
//!   paragraph's own flattened text (Phase 11.3 to-do rollup) so a tag panel can list actual
//!   tagged lines without a second per-row page read.
//! - `page_link`: one row per (source page, target page) wikilink extracted
//!   from a page's `text-box`/`table` objects, populated the same way
//!   `paragraph_tag` is (delete-then-reinsert during `index_page`) — see
//!   `crate::page_index::extract_wikilink_targets`. Source and target page
//!   ids are allowed to be equal (a page linking to itself is a legitimate
//!   self-reference, not filtered out anywhere in this crate).
//! - `page_vector`: one row per page holding its static-embedding vector (Phase 13's local
//!   semantic layer — see `crate::semantic`), as a bare little-endian f32 blob with no header,
//!   the same house format `renote-storage::blob` uses. `dim` lets a row written by a different
//!   model be skipped rather than mis-read if the bundled model is ever swapped.
//!
//! The schema version is stored via SQLite's built-in `PRAGMA user_version`
//! rather than a bespoke `meta` table — one less table to keep in sync, and
//! it's exactly what the pragma exists for.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::IndexError;

/// Folder (inside a notebook's root) the index file lives under.
pub const INDEX_DIR_NAME: &str = ".renote-index";
/// Filename of the index database inside [`INDEX_DIR_NAME`].
pub const INDEX_FILE_NAME: &str = "index.sqlite";

/// The schema version this build of `renote-index` expects. Bumping this
/// constant is the entire "migration": any existing index file stamped
/// with a different version is dropped and rebuilt from scratch the next
/// time [`crate::open_or_rebuild`] runs, rather than migrated in place.
pub const CURRENT_INDEX_SCHEMA_VERSION: i32 = 3;

/// The path a notebook's index database lives at, given its root folder.
pub fn index_path(notebook_dir: &Path) -> PathBuf {
    notebook_dir.join(INDEX_DIR_NAME).join(INDEX_FILE_NAME)
}

/// Opens (creating the parent `.renote-index/` folder if needed) a raw
/// connection to the index database at `path`, without touching schema or
/// version. Low-level building block for [`crate::open_or_rebuild`] and
/// for tests that need to simulate a stale/corrupt index file.
pub fn open_connection(path: &Path) -> Result<Connection, IndexError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|source| IndexError::Io { path: parent.to_path_buf(), source })?;
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

/// Reads `PRAGMA user_version` off `conn`.
pub fn schema_version(conn: &Connection) -> Result<i32, IndexError> {
    Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}

/// Creates every table/virtual table this crate needs (idempotent — safe
/// to call on an already-initialized database) and stamps
/// `PRAGMA user_version` to [`CURRENT_INDEX_SCHEMA_VERSION`].
pub fn ensure_schema(conn: &Connection) -> Result<(), IndexError> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS section_group (
            id TEXT PRIMARY KEY,
            notebook_id TEXT NOT NULL,
            parent_id TEXT,
            name TEXT NOT NULL,
            order_key TEXT NOT NULL,
            dir_path TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS section (
            id TEXT PRIMARY KEY,
            notebook_id TEXT NOT NULL,
            parent_group_id TEXT,
            name TEXT NOT NULL,
            color TEXT,
            order_key TEXT NOT NULL,
            dir_path TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS page (
            id TEXT PRIMARY KEY,
            notebook_id TEXT NOT NULL,
            section_id TEXT NOT NULL,
            parent_page_id TEXT,
            order_key TEXT NOT NULL,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            modified_at TEXT NOT NULL,
            section_dir TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS page_section_idx ON page (section_id);
        CREATE INDEX IF NOT EXISTS section_notebook_idx ON section (notebook_id);
        CREATE INDEX IF NOT EXISTS section_group_notebook_idx ON section_group (notebook_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(
            page_id UNINDEXED,
            title,
            body,
            tokenize = 'porter unicode61'
        );

        CREATE TABLE IF NOT EXISTS tag (
            id TEXT PRIMARY KEY,
            notebook_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            label TEXT NOT NULL,
            color TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS paragraph_tag (
            page_id TEXT NOT NULL,
            object_id TEXT NOT NULL,
            paragraph_index INTEGER NOT NULL,
            tag_id TEXT NOT NULL,
            text TEXT NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS paragraph_tag_tag_idx ON paragraph_tag (tag_id);

        CREATE TABLE IF NOT EXISTS page_link (
            source_page_id TEXT NOT NULL,
            target_page_id TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS page_link_target_idx ON page_link (target_page_id);
        CREATE INDEX IF NOT EXISTS page_link_source_idx ON page_link (source_page_id);

        CREATE TABLE IF NOT EXISTS page_vector (
            page_id TEXT PRIMARY KEY,
            dim INTEGER NOT NULL,
            vec BLOB NOT NULL
        );
        ",
    )?;
    conn.pragma_update(None, "user_version", CURRENT_INDEX_SCHEMA_VERSION)?;
    Ok(())
}

/// Deletes every row from every table this crate owns, without dropping
/// the tables themselves. Used by [`crate::rebuild_from_scan`] to start a
/// clean rescan against an already-open connection.
pub fn clear_all(conn: &Connection) -> Result<(), IndexError> {
    conn.execute_batch(
        "
        DELETE FROM section_group;
        DELETE FROM section;
        DELETE FROM page;
        DELETE FROM page_fts;
        DELETE FROM tag;
        DELETE FROM paragraph_tag;
        DELETE FROM page_link;
        DELETE FROM page_vector;
        ",
    )?;
    Ok(())
}
