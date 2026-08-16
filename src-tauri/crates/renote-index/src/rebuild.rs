//! Rebuild-from-scan: the core safety mechanism the plan relies on to keep
//! the index a purely *derived* artifact. Given a notebook's root folder,
//! walks it via `renote-storage`'s own listing functions only (never
//! touching the filesystem directly) and repopulates a fresh index from
//! scratch — used both for disaster recovery (index file deleted/corrupt)
//! and whenever [`crate::open_or_rebuild`] finds a schema-version mismatch.

use std::path::Path;

use rusqlite::Connection;

use crate::error::IndexError;
use crate::{page_index, schema};

/// Clears every table in `conn` and repopulates it by walking `notebook_dir`
/// through `renote_storage::list_section_groups`/`list_sections`/
/// `list_pages`/`read_page` — i.e. exactly the same public API any other
/// caller of `renote-storage` would use, so the index can never see data the
/// storage crate itself wouldn't produce.
pub fn rebuild_from_scan(
    conn: &Connection,
    notebook_dir: &Path,
    notebook_id: &str,
) -> Result<(), IndexError> {
    schema::clear_all(conn)?;
    walk_dir(conn, notebook_dir, notebook_id)?;

    // Tags live directly under `notebook_dir` (`tags.json`, via
    // `renote_storage::list_tags`), not nested per-section like pages, so
    // this is a top-level call here rather than inside `walk_dir`'s
    // recursion — same "only through renote-storage's own public API"
    // discipline the page/section walk below already follows.
    let tags = renote_storage::list_tags(notebook_dir)?;
    page_index::index_tags(conn, notebook_id, &tags)?;

    Ok(())
}

/// Recursively indexes every section (and its pages) and every nested
/// section-group directly and indirectly under `dir`.
fn walk_dir(conn: &Connection, dir: &Path, notebook_id: &str) -> Result<(), IndexError> {
    for section in renote_storage::list_sections(dir)? {
        let section_dir = renote_storage::section_dir(dir, &section.id);
        page_index::index_section(conn, &section, &section_dir)?;

        for page_meta in renote_storage::list_pages(&section_dir)? {
            let doc = renote_storage::read_page(&section_dir, &page_meta.id)?;
            page_index::index_page(conn, notebook_id, &doc.page, &doc.objects, &section_dir)?;
        }
    }

    for group in renote_storage::list_section_groups(dir)? {
        let group_dir = renote_storage::section_group_dir(dir, &group.id);
        page_index::index_section_group(conn, &group, &group_dir)?;
        walk_dir(conn, &group_dir, notebook_id)?;
    }

    Ok(())
}
