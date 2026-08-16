//! renote-index: the per-notebook SQLite/FTS5 derived index.
//!
//! This crate never touches a notebook's files directly except through
//! `renote-storage`'s public API (see [`rebuild_from_scan`]) — it depends
//! on `renote-storage`'s types, never the reverse. It owns:
//! - Schema/DDL and the version-check-and-rebuild open path ([`schema`],
//!   [`open_or_rebuild`]).
//! - Sync-on-write hooks the command layer calls after each mutating
//!   `renote-storage` write, so the index stays current without a full
//!   rescan on every change ([`page_index`]).
//! - Rebuild-from-scan, the disaster-recovery/schema-migration mechanism
//!   that makes "index is derived, never source of truth" safe ([`rebuild`]).
//! - FTS5 full-text search ([`search`]).
//!
//! ## On-disk layout
//! One SQLite file per notebook, at `<notebook-dir>/.renote-index/index.sqlite`
//! (see [`schema::index_path`]).
//!
//! ## Migration strategy (deliberately simpler than renote-storage's)
//! `renote-storage`'s `page.json` files are source of truth and get real
//! versioned migration on read. This index is purely derived, so instead
//! of writing incremental schema migrations, [`open_or_rebuild`] just
//! compares `PRAGMA user_version` against [`schema::CURRENT_INDEX_SCHEMA_VERSION`]
//! at notebook-open time: on a mismatch (including "no index file yet"),
//! it deletes the file and calls [`rebuild_from_scan`] — safe because there
//! is no unrecoverable data in this database, only what disk already holds.

mod error;
mod page_index;
mod rebuild;
mod schema;
mod search;
mod semantic;

use std::path::Path;

use rusqlite::Connection;

pub use error::IndexError;
pub use page_index::{
    extract_plain_text, extract_tag_assignments, extract_wikilink_targets, group_dir_path,
    index_page, index_section, index_section_group, index_tags, list_backlinks, list_page_links,
    list_page_locations, list_section_names, list_tagged_paragraphs, page_location, remove_page,
    remove_section, remove_section_group, section_dir_path, PageLocationRow, TagAssignment,
    TaggedParagraphRow,
};
pub use rebuild::rebuild_from_scan;
pub use schema::{index_path, CURRENT_INDEX_SCHEMA_VERSION, INDEX_DIR_NAME, INDEX_FILE_NAME};
pub use search::{search, SearchFilter, SearchHit};
pub use semantic::{embed, nearest, page_vector, SemanticHit};

/// Opens a notebook's index database, rebuilding it from scratch first if
/// it's missing or stamped with a different schema version than this build
/// expects (see the module docs' "Migration strategy" section). This is
/// the one function most callers (Tauri commands, tests) need — it always
/// hands back a connection with current schema and up-to-date-or-freshly-
/// rebuilt data.
pub fn open_or_rebuild(notebook_dir: &Path, notebook_id: &str) -> Result<Connection, IndexError> {
    let path = schema::index_path(notebook_dir);

    if path.is_file() {
        let conn = schema::open_connection(&path)?;
        if schema::schema_version(&conn)? == schema::CURRENT_INDEX_SCHEMA_VERSION {
            // Idempotent: a no-op if the schema is already fully set up,
            // but cheap insurance against a half-initialized file.
            schema::ensure_schema(&conn)?;
            return Ok(conn);
        }
        // Schema-version mismatch: drop the connection and the file, then
        // fall through to the fresh-create-and-rebuild path below.
        drop(conn);
        std::fs::remove_file(&path)
            .map_err(|source| IndexError::Io { path: path.clone(), source })?;
    }

    let conn = schema::open_connection(&path)?;
    schema::ensure_schema(&conn)?;
    rebuild::rebuild_from_scan(&conn, notebook_dir, notebook_id)?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    use renote_storage::{
        create_notebook, create_page, create_section, write_page, Bounds, PageBackground,
        PageObjectEnvelope, PageRuleLines, Transform2D,
    };

    fn sample_transform() -> Transform2D {
        Transform2D { x: 0.0, y: 0.0, rotation: 0.0, scale_x: 1.0, scale_y: 1.0, z_index: 0.0 }
    }

    fn sample_bounds() -> Bounds {
        Bounds { x: 0.0, y: 0.0, width: 10.0, height: 10.0 }
    }

    /// Builds a notebook/section/two-pages tree via `renote-storage` only
    /// (never touching the index directly), matching the Phase-1
    /// acceptance criterion's setup.
    fn build_sample_notebook(root: &Path) -> (renote_storage::Notebook, renote_storage::Section) {
        let notebook = create_notebook(root, "Research", None).expect("create_notebook");
        let notebook_dir = Path::new(&notebook.path).to_path_buf();
        let section = create_section(&notebook_dir, &notebook.id, None, "Ideas", None, "a0")
            .expect("create_section");
        let section_dir = renote_storage::section_dir(&notebook_dir, &section.id);

        let mut page_one = create_page(
            &section_dir,
            &section.id,
            None,
            "a0",
            "Rocket Notes",
            PageBackground { color: None, rule_lines: PageRuleLines::None },
            None,
        )
        .expect("create_page one");
        let objects_one = vec![PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "text-box".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({ "content": { "text": "Falcon engines burn kerosene" } }),
        }];
        write_page(&section_dir, &mut page_one, &objects_one).expect("write_page one");

        let mut page_two = create_page(
            &section_dir,
            &section.id,
            None,
            "a1",
            "Grocery List",
            PageBackground { color: None, rule_lines: PageRuleLines::None },
            None,
        )
        .expect("create_page two");
        let objects_two = vec![PageObjectEnvelope {
            id: "obj-2".to_string(),
            r#type: "text-box".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({ "content": { "text": "Buy milk and kerosene lamp oil" } }),
        }];
        write_page(&section_dir, &mut page_two, &objects_two).expect("write_page two");

        (notebook, section)
    }

    #[test]
    fn indexes_a_scanned_notebook_and_search_finds_expected_hits() {
        let root = tempfile::tempdir().expect("tempdir");
        let (notebook, _section) = build_sample_notebook(root.path());
        let notebook_dir = Path::new(&notebook.path).to_path_buf();

        let conn = open_or_rebuild(&notebook_dir, &notebook.id).expect("open_or_rebuild");

        let hits = search(&conn, "kerosene", &SearchFilter::default()).expect("search");
        assert_eq!(hits.len(), 2, "both pages mention kerosene");

        let hits = search(&conn, "rocket", &SearchFilter::default()).expect("search");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Rocket Notes");
        assert_eq!(hits[0].notebook_id, notebook.id);
    }

    /// The exact Phase-1 acceptance criterion for the index half: delete
    /// the index file, rebuild via rescan, and confirm the rebuilt index's
    /// query results match the pre-deletion results.
    #[test]
    fn rebuild_after_deleting_index_file_matches_pre_deletion_results() {
        let root = tempfile::tempdir().expect("tempdir");
        let (notebook, _section) = build_sample_notebook(root.path());
        let notebook_dir = Path::new(&notebook.path).to_path_buf();

        let conn = open_or_rebuild(&notebook_dir, &notebook.id).expect("open_or_rebuild");
        let before = search(&conn, "kerosene", &SearchFilter::default()).expect("search before");
        drop(conn);

        let index_file = index_path(&notebook_dir);
        assert!(index_file.is_file(), "index file should exist before deletion");
        std::fs::remove_file(&index_file).expect("delete index file");
        assert!(!index_file.is_file());

        let rebuilt_conn =
            open_or_rebuild(&notebook_dir, &notebook.id).expect("re-open after delete");
        let after =
            search(&rebuilt_conn, "kerosene", &SearchFilter::default()).expect("search after");

        let mut before_sorted = before;
        let mut after_sorted = after;
        before_sorted.sort_by(|a, b| a.page_id.cmp(&b.page_id));
        after_sorted.sort_by(|a, b| a.page_id.cmp(&b.page_id));
        for (b, a) in before_sorted.iter().zip(after_sorted.iter()) {
            assert_eq!(b.page_id, a.page_id);
            assert_eq!(b.title, a.title);
            assert_eq!(b.notebook_id, a.notebook_id);
            assert_eq!(b.section_id, a.section_id);
        }
        assert_eq!(before_sorted.len(), after_sorted.len());
    }

    /// A schema-version mismatch (simulating an index written by an older
    /// build) must trigger drop-and-rebuild, not a stale read or an error.
    #[test]
    fn schema_version_mismatch_triggers_rebuild() {
        let root = tempfile::tempdir().expect("tempdir");
        let (notebook, _section) = build_sample_notebook(root.path());
        let notebook_dir = Path::new(&notebook.path).to_path_buf();

        // First open builds a valid current-version index.
        let conn = open_or_rebuild(&notebook_dir, &notebook.id).expect("initial open_or_rebuild");
        assert_eq!(schema::schema_version(&conn).unwrap(), CURRENT_INDEX_SCHEMA_VERSION);
        // Stamp an old version, simulating an index built by a previous
        // crate version whose schema no longer matches.
        conn.pragma_update(None, "user_version", 0).unwrap();
        drop(conn);

        let reopened =
            open_or_rebuild(&notebook_dir, &notebook.id).expect("reopen after stale stamp");
        assert_eq!(schema::schema_version(&reopened).unwrap(), CURRENT_INDEX_SCHEMA_VERSION);

        // Data must have been rebuilt (not just left empty from a wipe),
        // proving the mismatch path actually rescanned the notebook.
        let hits = search(&reopened, "kerosene", &SearchFilter::default()).expect("search");
        assert_eq!(hits.len(), 2);
    }

    /// The exact design constraint a recycle bin has to satisfy: trashing a
    /// page must (a) actually remove its content from disk so a real move
    /// happened, (b) round-trip correctly through restore, and (c) — the
    /// one that's invisible until you specifically check for it — never
    /// come back after an index rebuild-from-scan, because
    /// `.renote-trash/` sits outside the directory tree
    /// `rebuild_from_scan` walks. Without that last assertion, a bug that
    /// puts trash inside the scanned tree (or fails to skip it) would pass
    /// every other test here and only surface once a real user deleted a
    /// page and the index later rebuilt.
    #[test]
    fn trashing_a_page_removes_it_from_disk_and_rebuild_never_resurrects_it() {
        let root = tempfile::tempdir().expect("tempdir");
        let (notebook, section) = build_sample_notebook(root.path());
        let notebook_dir = Path::new(&notebook.path).to_path_buf();
        let section_dir = renote_storage::section_dir(&notebook_dir, &section.id);

        let conn = open_or_rebuild(&notebook_dir, &notebook.id).expect("open_or_rebuild");
        let before = search(&conn, "kerosene", &SearchFilter::default()).expect("search before");
        assert_eq!(before.len(), 2, "both sample pages mention kerosene before trashing");

        let page = renote_storage::list_pages(&section_dir)
            .expect("list_pages")
            .into_iter()
            .find(|p| p.title == "Rocket Notes")
            .expect("Rocket Notes page exists");

        assert!(renote_storage::page_json_path(&section_dir, &page.id).is_file());
        let trash_entry =
            renote_storage::trash_page(root.path(), &section_dir, &notebook.id, &page)
                .expect("trash_page");
        assert!(
            !renote_storage::page_json_path(&section_dir, &page.id).exists(),
            "page.json must be gone from its original location"
        );

        // Sync-on-write: the command layer would call remove_page here, same as any other write.
        remove_page(&conn, &page.id).expect("remove_page");
        let after_trash =
            search(&conn, "kerosene", &SearchFilter::default()).expect("search after trash");
        assert_eq!(after_trash.len(), 1, "the trashed page must no longer be searchable");

        // The critical assertion: delete the index file and rebuild purely
        // from disk. If trash lived inside the scanned tree, this is where
        // the trashed page would silently reappear.
        drop(conn);
        std::fs::remove_file(index_path(&notebook_dir)).expect("delete index file");
        let rebuilt = open_or_rebuild(&notebook_dir, &notebook.id).expect("rebuild from scan");
        let after_rebuild =
            search(&rebuilt, "kerosene", &SearchFilter::default()).expect("search after rebuild");
        assert_eq!(after_rebuild.len(), 1, "rebuild-from-scan must not resurrect a trashed page");
        assert!(
            after_rebuild.iter().all(|hit| hit.page_id != page.id),
            "the trashed page's id specifically must not reappear"
        );

        // Restore round-trip: the page comes back exactly where it left, and re-indexing finds it again.
        let restored =
            renote_storage::restore_from_trash(root.path(), &trash_entry.id, &section_dir)
                .expect("restore_from_trash");
        assert_eq!(restored.original_id, page.id);
        assert!(
            renote_storage::page_json_path(&section_dir, &page.id).is_file(),
            "page.json restored to its original location"
        );

        let restored_doc =
            renote_storage::read_page(&section_dir, &page.id).expect("read restored page");
        assert_eq!(restored_doc.page.title, "Rocket Notes");

        index_page(&rebuilt, &notebook.id, &restored_doc.page, &restored_doc.objects, &section_dir)
            .expect("re-index restored page");
        let after_restore =
            search(&rebuilt, "kerosene", &SearchFilter::default()).expect("search after restore");
        assert_eq!(after_restore.len(), 2, "the restored page is searchable again");
    }

    /// Phase 5.7 acceptance criterion: a fresh `rebuild_from_scan` over a notebook with a
    /// `tags.json` and a paragraph tagged in a page's text-box content produces the expected
    /// `tag`/`paragraph_tag` rows, tag-filtered search finds only the tagged page, and deleting
    /// the index file and rebuilding again produces byte-identical rows — the same
    /// delete-and-rebuild-produces-identical-rows convention every other index table already has.
    #[test]
    fn rebuild_from_scan_populates_tag_and_paragraph_tag_rows_and_survives_a_rebuild() {
        let root = tempfile::tempdir().expect("tempdir");
        let notebook =
            create_notebook(root.path(), "Tagged Notebook", None).expect("create_notebook");
        let notebook_dir = Path::new(&notebook.path).to_path_buf();

        let tag = renote_storage::create_tag(
            &notebook_dir,
            renote_storage::TagKind::Important,
            "Important",
            "#ff0000",
        )
        .expect("create_tag");
        let other_tag = renote_storage::create_tag(
            &notebook_dir,
            renote_storage::TagKind::Idea,
            "Idea",
            "#00ff00",
        )
        .expect("create_tag other");

        let section = create_section(&notebook_dir, &notebook.id, None, "Ideas", None, "a0")
            .expect("create_section");
        let section_dir = renote_storage::section_dir(&notebook_dir, &section.id);

        let mut tagged_page = create_page(
            &section_dir,
            &section.id,
            None,
            "a0",
            "Tagged Page",
            PageBackground { color: None, rule_lines: PageRuleLines::None },
            None,
        )
        .expect("create_page tagged");
        let tagged_objects = vec![PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "text-box".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({
                "content": {
                    "paragraphs": [
                        { "runs": [{ "text": "Tagged paragraph", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": tag.id }
                    ]
                }
            }),
        }];
        write_page(&section_dir, &mut tagged_page, &tagged_objects).expect("write_page tagged");

        let mut untagged_page = create_page(
            &section_dir,
            &section.id,
            None,
            "a1",
            "Untagged Page",
            PageBackground { color: None, rule_lines: PageRuleLines::None },
            None,
        )
        .expect("create_page untagged");
        let untagged_objects = vec![PageObjectEnvelope {
            id: "obj-2".to_string(),
            r#type: "text-box".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({
                "content": {
                    "paragraphs": [
                        { "runs": [{ "text": "No tag here", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": null }
                    ]
                }
            }),
        }];
        write_page(&section_dir, &mut untagged_page, &untagged_objects)
            .expect("write_page untagged");

        let conn = open_or_rebuild(&notebook_dir, &notebook.id).expect("open_or_rebuild");

        let mut tag_ids: Vec<String> = conn
            .prepare("SELECT id FROM tag WHERE notebook_id = ?1 ORDER BY id")
            .unwrap()
            .query_map(rusqlite::params![notebook.id], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        tag_ids.sort();
        let mut expected_tag_ids = vec![tag.id.clone(), other_tag.id.clone()];
        expected_tag_ids.sort();
        assert_eq!(tag_ids, expected_tag_ids);

        let paragraph_tag_rows: Vec<(String, String, i64, String)> = conn
            .prepare("SELECT page_id, object_id, paragraph_index, tag_id FROM paragraph_tag")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            paragraph_tag_rows.len(),
            1,
            "only the tagged page's paragraph should be indexed"
        );
        assert_eq!(paragraph_tag_rows[0].0, tagged_page.id);
        assert_eq!(paragraph_tag_rows[0].1, "obj-1");
        assert_eq!(paragraph_tag_rows[0].2, 0);
        assert_eq!(paragraph_tag_rows[0].3, tag.id);

        // Tag-filtered search: the tag filter alone (empty free-text-less query still requires
        // some text, so search on the shared word "page" and narrow by tag) returns only the
        // tagged page, never the untagged one.
        let tag_filter =
            SearchFilter { tag_ids: Some(std::slice::from_ref(&tag.id)), ..Default::default() };
        let hits = search(&conn, "page", &tag_filter).expect("tag-filtered search");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].page_id, tagged_page.id);

        // The other tag matches nothing (no paragraph references it).
        let other_tag_filter = SearchFilter {
            tag_ids: Some(std::slice::from_ref(&other_tag.id)),
            ..Default::default()
        };
        let other_hits = search(&conn, "page", &other_tag_filter).expect("other tag search");
        assert!(other_hits.is_empty());

        // Delete-and-rebuild: the rebuilt tag/paragraph_tag rows must match exactly.
        drop(conn);
        std::fs::remove_file(index_path(&notebook_dir)).expect("delete index file");
        let rebuilt = open_or_rebuild(&notebook_dir, &notebook.id).expect("rebuild from scan");

        let mut rebuilt_tag_ids: Vec<String> = rebuilt
            .prepare("SELECT id FROM tag WHERE notebook_id = ?1 ORDER BY id")
            .unwrap()
            .query_map(rusqlite::params![notebook.id], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        rebuilt_tag_ids.sort();
        assert_eq!(rebuilt_tag_ids, expected_tag_ids, "tag rows must be identical after rebuild");

        let rebuilt_paragraph_tag_rows: Vec<(String, String, i64, String)> = rebuilt
            .prepare("SELECT page_id, object_id, paragraph_index, tag_id FROM paragraph_tag")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            rebuilt_paragraph_tag_rows, paragraph_tag_rows,
            "paragraph_tag rows must be identical after rebuild"
        );
    }

    /// Clicking a tag in the UI (no free-text query, just a tag filter) must still return the
    /// pages carrying that tag — the "browse by tag" search path search.rs added alongside the
    /// tag-ids filter, distinct from the ordinary "empty query text = no hits" rule.
    #[test]
    fn empty_text_query_with_a_tag_filter_returns_tagged_pages() {
        let root = tempfile::tempdir().expect("tempdir");
        let notebook =
            create_notebook(root.path(), "Tag Browse Notebook", None).expect("create_notebook");
        let notebook_dir = Path::new(&notebook.path).to_path_buf();

        let tag = renote_storage::create_tag(
            &notebook_dir,
            renote_storage::TagKind::Idea,
            "Idea",
            "#00ff00",
        )
        .expect("create_tag");

        let section = create_section(&notebook_dir, &notebook.id, None, "Sec", None, "a0")
            .expect("create_section");
        let section_dir = renote_storage::section_dir(&notebook_dir, &section.id);

        let mut page = create_page(
            &section_dir,
            &section.id,
            None,
            "a0",
            "Idea Page",
            PageBackground { color: None, rule_lines: PageRuleLines::None },
            None,
        )
        .expect("create_page");
        let objects = vec![PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "text-box".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({
                "content": {
                    "paragraphs": [
                        { "runs": [], "listKind": "none", "indentLevel": 0, "tagId": tag.id }
                    ]
                }
            }),
        }];
        write_page(&section_dir, &mut page, &objects).expect("write_page");

        let conn = open_or_rebuild(&notebook_dir, &notebook.id).expect("open_or_rebuild");

        // Empty query text, no tag filter: still no hits (the ordinary rule).
        let no_filter_hits = search(&conn, "", &SearchFilter::default()).expect("search no filter");
        assert!(no_filter_hits.is_empty());

        // Empty query text WITH a tag filter: the tagged page comes back.
        let tag_filter =
            SearchFilter { tag_ids: Some(std::slice::from_ref(&tag.id)), ..Default::default() };
        let tag_hits = search(&conn, "", &tag_filter).expect("search with tag filter");
        assert_eq!(tag_hits.len(), 1);
        assert_eq!(tag_hits[0].page_id, page.id);
        assert_eq!(tag_hits[0].title, "Idea Page");
    }

    /// Phase 7 acceptance criterion, mirroring the Phase 5.7 tag test above: a fresh
    /// `rebuild_from_scan` over a notebook containing a page whose text-box content carries
    /// wikilink marks (including one pointing at the SAME page, a self-link) produces the
    /// expected `page_link` rows, `list_backlinks`/`list_page_links` return correct results, and
    /// deleting the index file and rebuilding again produces byte-identical rows.
    #[test]
    fn rebuild_from_scan_populates_page_link_rows_and_survives_a_rebuild() {
        let root = tempfile::tempdir().expect("tempdir");
        let notebook =
            create_notebook(root.path(), "Linked Notebook", None).expect("create_notebook");
        let notebook_dir = Path::new(&notebook.path).to_path_buf();

        let section = create_section(&notebook_dir, &notebook.id, None, "Ideas", None, "a0")
            .expect("create_section");
        let section_dir = renote_storage::section_dir(&notebook_dir, &section.id);

        let mut target_page = create_page(
            &section_dir,
            &section.id,
            None,
            "a0",
            "Target Page",
            PageBackground { color: None, rule_lines: PageRuleLines::None },
            None,
        )
        .expect("create_page target");
        write_page(&section_dir, &mut target_page, &[])
            .expect("write_page target (no content needed)");

        let mut linking_page = create_page(
            &section_dir,
            &section.id,
            None,
            "a1",
            "Linking Page",
            PageBackground { color: None, rule_lines: PageRuleLines::None },
            None,
        )
        .expect("create_page linking");
        let linking_page_id = linking_page.id.clone();
        let target_page_id = target_page.id.clone();
        let linking_objects = vec![PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "text-box".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({
                "content": {
                    "paragraphs": [
                        {
                            "runs": [
                                {
                                    "text": "Target Page",
                                    "marks": [{ "kind": "wikilink", "attr": target_page_id, "attr2": "Target Page" }]
                                },
                                { "text": " and myself ", "marks": [] },
                                {
                                    "text": "Linking Page",
                                    "marks": [{ "kind": "wikilink", "attr": linking_page_id, "attr2": "Linking Page" }]
                                },
                            ],
                            "listKind": "none",
                            "indentLevel": 0,
                            "tagId": null
                        }
                    ]
                }
            }),
        }];
        write_page(&section_dir, &mut linking_page, &linking_objects).expect("write_page linking");

        let conn = open_or_rebuild(&notebook_dir, &notebook.id).expect("open_or_rebuild");

        let backlinks_to_target =
            list_backlinks(&conn, &target_page_id).expect("list_backlinks target");
        assert_eq!(backlinks_to_target, vec![linking_page_id.clone()]);

        // The self-link: the linking page backlinks to itself too.
        let backlinks_to_linking =
            list_backlinks(&conn, &linking_page_id).expect("list_backlinks linking");
        assert_eq!(backlinks_to_linking, vec![linking_page_id.clone()]);

        // The target page, having no outgoing links of its own, has no backlinks pointing at it
        // from anywhere except the linking page above (already asserted), and produces none of
        // its own as a source.
        let mut all_links = list_page_links(&conn, &notebook.id).expect("list_page_links");
        all_links.sort();
        let mut expected_links = vec![
            (linking_page_id.clone(), target_page_id.clone()),
            (linking_page_id.clone(), linking_page_id.clone()),
        ];
        expected_links.sort();
        assert_eq!(all_links, expected_links);

        // Delete-and-rebuild: the rebuilt page_link rows must match exactly.
        drop(conn);
        std::fs::remove_file(index_path(&notebook_dir)).expect("delete index file");
        let rebuilt = open_or_rebuild(&notebook_dir, &notebook.id).expect("rebuild from scan");

        let mut rebuilt_links =
            list_page_links(&rebuilt, &notebook.id).expect("list_page_links rebuilt");
        rebuilt_links.sort();
        assert_eq!(rebuilt_links, expected_links, "page_link rows must be identical after rebuild");

        let rebuilt_backlinks =
            list_backlinks(&rebuilt, &target_page_id).expect("list_backlinks rebuilt");
        assert_eq!(rebuilt_backlinks, vec![linking_page_id]);
    }
}
