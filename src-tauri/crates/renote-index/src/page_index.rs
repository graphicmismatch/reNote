//! Sync-on-write hooks: functions the command layer (or `crate::rebuild`)
//! calls to keep the index consistent with a single incremental change to
//! `renote-storage`'s on-disk data, without requiring a full rescan on
//! every write. Each function is a plain upsert/delete against the tables
//! defined in `crate::schema` — no filesystem access here, callers pass in
//! whatever path information they already have.

use std::path::Path;

use rusqlite::{params, Connection};

use renote_storage::{Page, PageObjectEnvelope, Section, SectionGroup, Tag};

use crate::error::IndexError;
use crate::semantic;

/// Inserts or updates a section-group's row.
pub fn index_section_group(
    conn: &Connection,
    group: &SectionGroup,
    dir_path: &Path,
) -> Result<(), IndexError> {
    conn.execute(
        "INSERT INTO section_group (id, notebook_id, parent_id, name, order_key, dir_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            notebook_id = excluded.notebook_id,
            parent_id = excluded.parent_id,
            name = excluded.name,
            order_key = excluded.order_key,
            dir_path = excluded.dir_path",
        params![
            group.id,
            group.notebook_id,
            group.parent_id,
            group.name,
            group.order_key,
            path_to_text(dir_path),
        ],
    )?;
    Ok(())
}

/// Removes a section-group's row. Does not cascade to nested
/// sections/groups — callers rescan or remove those explicitly, matching
/// `renote_storage::delete_section_group`'s all-at-once filesystem removal
/// (the command layer calling this after a delete should follow up with a
/// full rebuild if it needs cascading cleanup rather than tracking it row
/// by row here).
pub fn remove_section_group(conn: &Connection, group_id: &str) -> Result<(), IndexError> {
    conn.execute("DELETE FROM section_group WHERE id = ?1", params![group_id])?;
    Ok(())
}

/// Inserts or updates a section's row.
pub fn index_section(
    conn: &Connection,
    section: &Section,
    dir_path: &Path,
) -> Result<(), IndexError> {
    conn.execute(
        "INSERT INTO section (id, notebook_id, parent_group_id, name, color, order_key, dir_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            notebook_id = excluded.notebook_id,
            parent_group_id = excluded.parent_group_id,
            name = excluded.name,
            color = excluded.color,
            order_key = excluded.order_key,
            dir_path = excluded.dir_path",
        params![
            section.id,
            section.notebook_id,
            section.parent_group_id,
            section.name,
            section.color,
            section.order_key,
            path_to_text(dir_path),
        ],
    )?;
    Ok(())
}

/// Removes a section's row and every page row/FTS row that belonged to it.
pub fn remove_section(conn: &Connection, section_id: &str) -> Result<(), IndexError> {
    let page_ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM page WHERE section_id = ?1")?;
        let rows = stmt.query_map(params![section_id], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<_, _>>()?
    };
    for page_id in &page_ids {
        remove_page(conn, page_id)?;
    }
    conn.execute("DELETE FROM section WHERE id = ?1", params![section_id])?;
    Ok(())
}

/// Looks up a section's absolute directory path by id, if indexed.
pub fn section_dir_path(conn: &Connection, section_id: &str) -> Result<Option<String>, IndexError> {
    conn.query_row("SELECT dir_path FROM section WHERE id = ?1", params![section_id], |row| {
        row.get(0)
    })
    .map(Some)
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.into()),
    })
}

/// Looks up a section-group's absolute directory path by id, if indexed.
pub fn group_dir_path(conn: &Connection, group_id: &str) -> Result<Option<String>, IndexError> {
    conn.query_row("SELECT dir_path FROM section_group WHERE id = ?1", params![group_id], |row| {
        row.get(0)
    })
    .map(Some)
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.into()),
    })
}

/// Looks up a page's owning `section_id` and the absolute directory its `<pageId>.page.json`
/// lives in, by id — lets `renote-commands::link::list_backlinks` resolve each backlinked page
/// id straight to a `renote_storage::read_page` call (and from there a full `PageDto`) without a
/// separate notebook-wide section walk. `None` if the page isn't indexed.
pub fn page_location(
    conn: &Connection,
    page_id: &str,
) -> Result<Option<(String, String)>, IndexError> {
    conn.query_row(
        "SELECT section_id, section_dir FROM page WHERE id = ?1",
        params![page_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )
    .map(Some)
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.into()),
    })
}

/// One page's "where it lives" row: the page plus its owning section's name. The notebook half
/// of a full `Notebook > Section > Page` location is filled in by the command layer, since one
/// index database only ever covers one notebook (see this crate's module docs).
#[derive(Debug, Clone, PartialEq)]
pub struct PageLocationRow {
    pub page_id: String,
    pub page_title: String,
    pub section_id: String,
    pub section_name: String,
}

/// Every indexed page in this notebook, each with its owning section's name — the location list
/// the frontend's link autocomplete renders (`Notebook > Section > Page`) and resolves an exact
/// `[[!Notebook@Section$Page` path against. Pages whose section row is missing (an index that
/// briefly lags a section removal) are skipped by the join rather than reported location-less.
pub fn list_page_locations(
    conn: &Connection,
    notebook_id: &str,
) -> Result<Vec<PageLocationRow>, IndexError> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.title, p.section_id, s.name
         FROM page p JOIN section s ON s.id = p.section_id
         WHERE p.notebook_id = ?1
         ORDER BY s.name, p.title",
    )?;
    let rows = stmt.query_map(params![notebook_id], |row| {
        Ok(PageLocationRow {
            page_id: row.get(0)?,
            page_title: row.get(1)?,
            section_id: row.get(2)?,
            section_name: row.get(3)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(IndexError::from)
}

/// Every `(section id, section name)` in this notebook, at any nesting depth — what
/// `renote-commands::naming` checks a new/renamed section's name against, since section names
/// are unique per notebook, not per section group.
pub fn list_section_names(
    conn: &Connection,
    notebook_id: &str,
) -> Result<Vec<(String, String)>, IndexError> {
    let mut stmt = conn.prepare("SELECT id, name FROM section WHERE notebook_id = ?1")?;
    let rows = stmt.query_map(params![notebook_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(IndexError::from)
}

/// Inserts or updates a page's metadata row and its FTS row (title +
/// extracted plain text — see [`extract_plain_text`]). `section_dir` is the
/// folder the page's `<pageId>.page.json` lives in, stamped onto the row so
/// the command layer can resolve a page id straight to a `renote_storage`
/// call without a separate lookup.
pub fn index_page(
    conn: &Connection,
    notebook_id: &str,
    page: &Page,
    objects: &[PageObjectEnvelope],
    section_dir: &Path,
) -> Result<(), IndexError> {
    conn.execute(
        "INSERT INTO page (id, notebook_id, section_id, parent_page_id, order_key, title, created_at, modified_at, section_dir)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            notebook_id = excluded.notebook_id,
            section_id = excluded.section_id,
            parent_page_id = excluded.parent_page_id,
            order_key = excluded.order_key,
            title = excluded.title,
            created_at = excluded.created_at,
            modified_at = excluded.modified_at,
            section_dir = excluded.section_dir",
        params![
            page.id,
            notebook_id,
            page.section_id,
            page.parent_page_id,
            page.order_key,
            page.title,
            page.created_at,
            page.modified_at,
            path_to_text(section_dir),
        ],
    )?;

    // FTS5 has no native upsert; delete-then-insert the row for this page.
    conn.execute("DELETE FROM page_fts WHERE page_id = ?1", params![page.id])?;
    let body = extract_plain_text(objects);
    conn.execute(
        "INSERT INTO page_fts (page_id, title, body) VALUES (?1, ?2, ?3)",
        params![page.id, page.title, body],
    )?;

    // Phase 13: reuses the same `body` string just computed above, so semantic and lexical
    // search never disagree about what a page contains. Title is deliberately not prepended —
    // `body` alone is what `extract_plain_text` already defines as "this page's content".
    semantic::upsert_page_vector(conn, &page.id, &semantic::embed(&body))?;

    // Same delete-then-insert shape as page_fts above: there's no natural upsert key for a
    // page's whole set of paragraph-tag assignments, so the simplest correct approach is to
    // drop this page's rows and re-derive them from the current objects every time.
    conn.execute("DELETE FROM paragraph_tag WHERE page_id = ?1", params![page.id])?;
    for assignment in extract_tag_assignments(objects) {
        conn.execute(
            "INSERT INTO paragraph_tag (page_id, object_id, paragraph_index, tag_id, text) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                page.id,
                assignment.object_id,
                assignment.paragraph_index,
                assignment.tag_id,
                assignment.text,
            ],
        )?;
    }

    // Same delete-then-insert shape again for this page's outgoing wikilinks. A target page id
    // equal to `page.id` itself (a self-link) is inserted like any other row — see
    // `extract_wikilink_targets`'s doc comment.
    conn.execute("DELETE FROM page_link WHERE source_page_id = ?1", params![page.id])?;
    for target_page_id in extract_wikilink_targets(objects) {
        conn.execute(
            "INSERT INTO page_link (source_page_id, target_page_id) VALUES (?1, ?2)",
            params![page.id, target_page_id],
        )?;
    }

    Ok(())
}

/// Removes a page's metadata row, its FTS row, its paragraph-tag rows, and its outgoing
/// page-link rows (rows where it's the SOURCE). Rows where it's the TARGET of another page's
/// still-existing wikilink are deliberately left alone — mirrors how a deleted tag's `tag` row
/// disappears without retroactively rewriting other pages' content; the pointing-to page's own
/// next `index_page` call (or a rebuild) is what would eventually clear a truly stale reference.
pub fn remove_page(conn: &Connection, page_id: &str) -> Result<(), IndexError> {
    conn.execute("DELETE FROM page WHERE id = ?1", params![page_id])?;
    conn.execute("DELETE FROM page_fts WHERE page_id = ?1", params![page_id])?;
    conn.execute("DELETE FROM paragraph_tag WHERE page_id = ?1", params![page_id])?;
    conn.execute("DELETE FROM page_link WHERE source_page_id = ?1", params![page_id])?;
    semantic::remove_page_vector(conn, page_id)?;
    Ok(())
}

/// Every page id that links TO `target_page_id` — i.e. `target_page_id`'s "Linked Mentions"
/// (see `renote-commands::link::list_backlinks`). Distinct source page ids, in no particular
/// order (callers resolve each to a full `Page`/`PageDto` as needed). A page linking to itself
/// shows up here like any other backlink (`source_page_id == target_page_id` is not filtered).
pub fn list_backlinks(conn: &Connection, target_page_id: &str) -> Result<Vec<String>, IndexError> {
    let mut stmt =
        conn.prepare("SELECT DISTINCT source_page_id FROM page_link WHERE target_page_id = ?1")?;
    let rows = stmt.query_map(params![target_page_id], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Every `(source_page_id, target_page_id)` link pair among pages belonging to `notebook_id` —
/// feeds the graph view (`renote-commands::link::list_page_links`). `page_link` doesn't carry a
/// notebook id directly (a link is scoped by its SOURCE page, which does), so this joins through
/// `page` on `source_page_id` to scope the whole notebook's edge set in one query.
pub fn list_page_links(
    conn: &Connection,
    notebook_id: &str,
) -> Result<Vec<(String, String)>, IndexError> {
    let mut stmt = conn.prepare(
        "SELECT pl.source_page_id, pl.target_page_id FROM page_link pl \
         JOIN page p ON p.id = pl.source_page_id \
         WHERE p.notebook_id = ?1",
    )?;
    let rows = stmt.query_map(params![notebook_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// One row from [`list_tagged_paragraphs`]: a paragraph tagged with a given tag, plus enough
/// about its page to navigate there — the "to-do rollup" a tag panel lists (Phase 11.3).
/// `object_id` addresses which object on the page holds it, for a caller that wants to select or
/// center on it once the page is loaded.
#[derive(Debug, Clone, PartialEq)]
pub struct TaggedParagraphRow {
    pub page_id: String,
    pub page_title: String,
    pub object_id: String,
    pub text: String,
}

/// Every paragraph across `notebook_id` currently carrying `tag_id`, most-recently-modified page
/// first (the more useful default for a to-do rollup than the arbitrary order a delete-then-
/// insert table otherwise iterates in), ties broken by paragraph order within a page.
pub fn list_tagged_paragraphs(
    conn: &Connection,
    notebook_id: &str,
    tag_id: &str,
) -> Result<Vec<TaggedParagraphRow>, IndexError> {
    let mut stmt = conn.prepare(
        "SELECT pt.page_id, p.title, pt.object_id, pt.text
         FROM paragraph_tag pt
         JOIN page p ON p.id = pt.page_id
         WHERE p.notebook_id = ?1 AND pt.tag_id = ?2
         ORDER BY p.modified_at DESC, pt.paragraph_index ASC",
    )?;
    let rows = stmt.query_map(params![notebook_id, tag_id], |row| {
        Ok(TaggedParagraphRow {
            page_id: row.get(0)?,
            page_title: row.get(1)?,
            object_id: row.get(2)?,
            text: row.get(3)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(IndexError::from)
}

/// Replaces every `tag` row for `notebook_id` with `tags` (delete-then-insert, same reasoning
/// as `page_fts`/`paragraph_tag` above). Tag *definitions* are populated once per notebook
/// (not once per page like `paragraph_tag` assignments are) — callers run this alongside a
/// full notebook scan/rebuild or whenever a tag is created/updated/deleted, not per-page-save.
pub fn index_tags(conn: &Connection, notebook_id: &str, tags: &[Tag]) -> Result<(), IndexError> {
    conn.execute("DELETE FROM tag WHERE notebook_id = ?1", params![notebook_id])?;
    for tag in tags {
        conn.execute(
            "INSERT INTO tag (id, notebook_id, kind, label, color) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![tag.id, notebook_id, tag_kind_to_text(tag.kind), tag.label, tag.color],
        )?;
    }
    Ok(())
}

/// Renders a `TagKind` as the same kebab-case string its `serde` impl
/// produces on the JSON side (e.g. `TagKind::ToDo` -> `"to-do"`), so the
/// `tag.kind` column matches `packages/core/src/model/tag.ts`'s `TagKind`
/// union values byte-for-byte without duplicating the mapping by hand.
fn tag_kind_to_text(kind: renote_storage::TagKind) -> String {
    match serde_json::to_value(kind) {
        Ok(serde_json::Value::String(s)) => s,
        _ => unreachable!("TagKind always serializes to a JSON string"),
    }
}

/// One `(object, paragraph, tag)` assignment extracted from a page's objects.
#[derive(Debug, Clone, PartialEq)]
pub struct TagAssignment {
    pub object_id: String,
    pub paragraph_index: i64,
    pub tag_id: String,
    /// The tagged paragraph's own flattened text (Phase 11.3 to-do rollup) — what
    /// `list_tagged_paragraphs` lists without a second per-row page read.
    pub text: String,
}

/// Plain text of a paragraph-shaped JSON object's `runs` array (each run's own `text` field,
/// joined with no separator) — mirrors `apps/desktop/src/page-editor/page-anchors.ts`'s
/// `blockText`, the TS-side counterpart used for the same "read a paragraph's own text off
/// untyped JSON" job. An image run has no `text` field and contributes nothing.
fn paragraph_text(paragraph: &serde_json::Value) -> String {
    let Some(runs) = paragraph.get("runs").and_then(serde_json::Value::as_array) else {
        return String::new();
    };
    runs.iter().filter_map(|run| run.get("text").and_then(serde_json::Value::as_str)).collect()
}

/// Extracts every non-null `tagId` assignment from a page's `text-box`/`table`
/// objects, for populating `paragraph_tag`.
///
/// Same opaque-JSON-walk discipline as [`extract_plain_text`]: `data.content`
/// (text-box) and each cell of `data.cells` (table) are rich-text documents
/// from the not-yet-depended-on `packages/text-editor` schema, so rather than
/// coupling this crate to that schema, this recursively walks each tagged
/// object's `data` value and records every JSON object node carrying a
/// non-null string `tagId`. `paragraph_index` is a best-effort ordinal —
/// an incrementing counter per object, in document-order-of-discovery — not
/// a semantically exact paragraph position; nothing depends on it being
/// exact, it's purely informational (e.g. for a UI to jump near a match).
pub fn extract_tag_assignments(objects: &[PageObjectEnvelope]) -> Vec<TagAssignment> {
    let mut assignments = Vec::new();
    for object in objects {
        if object.r#type == "text-box" || object.r#type == "table" {
            let mut next_index: i64 = 0;
            collect_tag_ids(&object.data, &object.id, &mut next_index, &mut assignments);
        }
    }
    assignments
}

fn collect_tag_ids(
    value: &serde_json::Value,
    object_id: &str,
    next_index: &mut i64,
    out: &mut Vec<TagAssignment>,
) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(tag_id) = map.get("tagId").and_then(serde_json::Value::as_str) {
                out.push(TagAssignment {
                    object_id: object_id.to_string(),
                    paragraph_index: *next_index,
                    tag_id: tag_id.to_string(),
                    text: paragraph_text(value),
                });
                *next_index += 1;
            }
            for v in map.values() {
                collect_tag_ids(v, object_id, next_index, out);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_tag_ids(item, object_id, next_index, out);
            }
        }
        _ => {}
    }
}

/// Extracts every distinct wikilink target page id referenced anywhere in a page's
/// `text-box`/`table` objects, for populating `page_link`.
///
/// Same opaque-JSON-walk discipline as [`extract_tag_assignments`]/[`extract_plain_text`]:
/// rather than coupling this crate to `packages/text-editor`'s schema, this recursively walks
/// each object's `data` value and records the target page id of every JSON object node shaped
/// like `{"kind": "wikilink", "attr": "<pageId>", ...}` — exactly what a `TextMark` with
/// `kind: "wikilink"` serializes to (see `packages/text-editor/src/schema/marks.ts`'s
/// `TextMark.attr2` doc comment: `attr` carries the resolved page id, `attr2` the display text;
/// only `attr` matters here). The two sides of this JSON boundary must keep agreeing on the
/// `"kind"`/`"attr"` field names exactly, since `data` crosses from TypeScript to Rust as opaque
/// JSON with no shared schema to enforce it.
///
/// Deduplicated per page (linking to the same target from two different paragraphs produces one
/// `page_link` row, not two) but NOT deduplicated against the page's own id — a page linking to
/// itself is a legitimate self-reference and produces a row same as any other target.
pub fn extract_wikilink_targets(objects: &[PageObjectEnvelope]) -> Vec<String> {
    let mut targets: Vec<String> = Vec::new();
    for object in objects {
        if object.r#type == "text-box" || object.r#type == "table" {
            collect_wikilink_targets(&object.data, &mut targets);
        }
    }
    targets.sort();
    targets.dedup();
    targets
}

fn collect_wikilink_targets(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            if map.get("kind").and_then(serde_json::Value::as_str) == Some("wikilink") {
                if let Some(page_id) = map.get("attr").and_then(serde_json::Value::as_str) {
                    if !page_id.is_empty() {
                        out.push(page_id.to_string());
                    }
                }
            }
            for v in map.values() {
                collect_wikilink_targets(v, out);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_wikilink_targets(item, out);
            }
        }
        _ => {}
    }
}

/// Extracts a single plain-text blob for full-text search from a page's
/// objects.
///
/// `PageObjectEnvelope.data` is an opaque `serde_json::Value` — for a
/// `text-box` object, `data.content` is itself an opaque rich-text JSON
/// value from the not-yet-built `packages/text-editor` schema, so this
/// crate cannot know its internal structure. Rather than coupling
/// `renote-index` to that not-yet-designed schema, this recursively walks
/// each text-box object's entire `data` value and concatenates every JSON
/// string leaf it finds (object keys are not leaves, only string values
/// are). This naturally captures whatever text content the real editor
/// schema ends up producing later, since `content` is the only field
/// `TextBoxData` has today (see `packages/core/src/page-object/built-in-types.ts`)
/// — once the schema is designed, this keeps working without changes here.
///
/// Non-text-box object types (ink strokes, images, shapes, tables, file
/// attachments, audio clips) contribute no searchable text at this phase —
/// tables might later (their `cells` are rich-text documents too), but
/// that's out of scope for Phase 1.
pub fn extract_plain_text(objects: &[PageObjectEnvelope]) -> String {
    let mut parts = Vec::new();
    for object in objects {
        if object.r#type == "text-box" {
            collect_string_leaves(&object.data, &mut parts);
        }
    }
    parts.join(" ")
}

fn collect_string_leaves(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::String(s) => {
            if !s.trim().is_empty() {
                out.push(s.clone());
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_string_leaves(item, out);
            }
        }
        serde_json::Value::Object(map) => {
            for v in map.values() {
                collect_string_leaves(v, out);
            }
        }
        _ => {}
    }
}

fn path_to_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_plain_text_walks_nested_string_leaves_and_skips_non_text_box_objects() {
        let text_object = PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "text-box".to_string(),
            transform: renote_storage::Transform2D {
                x: 0.0,
                y: 0.0,
                rotation: 0.0,
                scale_x: 1.0,
                scale_y: 1.0,
                z_index: 0.0,
            },
            bounds: renote_storage::Bounds { x: 0.0, y: 0.0, width: 1.0, height: 1.0 },
            data: serde_json::json!({
                "content": {
                    "type": "doc",
                    "children": [
                        { "text": "Hello" },
                        { "text": "world" },
                        { "nested": { "deep": "value" } },
                    ]
                }
            }),
        };

        let ink_object = PageObjectEnvelope {
            id: "obj-2".to_string(),
            r#type: "ink-stroke".to_string(),
            transform: text_object.transform,
            bounds: text_object.bounds,
            data: serde_json::json!({ "tool": "pen", "color": "should-not-appear" }),
        };

        let text = extract_plain_text(&[text_object, ink_object]);
        assert!(text.contains("Hello"));
        assert!(text.contains("world"));
        assert!(text.contains("value"));
        assert!(!text.contains("should-not-appear"));
        // "type" and "doc" are a JSON key and a non-leaf-relevant string value
        // respectively; "doc" IS a string leaf and is included, which is fine —
        // this function has no semantic understanding of the rich-text schema.
    }

    fn sample_transform() -> renote_storage::Transform2D {
        renote_storage::Transform2D {
            x: 0.0,
            y: 0.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            z_index: 0.0,
        }
    }

    fn sample_bounds() -> renote_storage::Bounds {
        renote_storage::Bounds { x: 0.0, y: 0.0, width: 1.0, height: 1.0 }
    }

    #[test]
    fn extract_tag_assignments_finds_tagged_paragraphs_in_a_text_box() {
        let text_object = PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "text-box".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({
                "content": {
                    "paragraphs": [
                        { "runs": [{ "text": "Buy milk", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": "tag-a" },
                        { "runs": [], "listKind": "none", "indentLevel": 0, "tagId": null },
                        { "runs": [{ "text": "Call ", "marks": [] }, { "text": "Alex", "marks": [{ "kind": "bold" }] }], "listKind": "none", "indentLevel": 0, "tagId": "tag-b" },
                    ]
                }
            }),
        };

        let assignments = extract_tag_assignments(&[text_object]);
        assert_eq!(assignments.len(), 2);
        assert_eq!(assignments[0].object_id, "obj-1");
        assert_eq!(assignments[0].tag_id, "tag-a");
        assert_eq!(assignments[0].paragraph_index, 0);
        assert_eq!(assignments[0].text, "Buy milk");
        assert_eq!(assignments[1].tag_id, "tag-b");
        assert_eq!(assignments[1].paragraph_index, 1);
        assert_eq!(assignments[1].text, "Call Alex");
    }

    #[test]
    fn extract_tag_assignments_finds_tagged_cells_in_a_table_and_skips_other_types() {
        let table_object = PageObjectEnvelope {
            id: "obj-2".to_string(),
            r#type: "table".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({
                "columnWidths": [100.0],
                "rowHeights": [20.0],
                "cells": [[{
                    "paragraphs": [
                        { "runs": [], "listKind": "none", "indentLevel": 0, "tagId": "tag-c" }
                    ]
                }]],
                "mergedRanges": []
            }),
        };
        let ink_object = PageObjectEnvelope {
            id: "obj-3".to_string(),
            r#type: "ink-stroke".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({ "tagId": "should-not-appear" }),
        };

        let assignments = extract_tag_assignments(&[table_object, ink_object]);
        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].object_id, "obj-2");
        assert_eq!(assignments[0].tag_id, "tag-c");
    }

    #[test]
    fn index_tags_replaces_a_notebooks_tag_rows() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        crate::schema::ensure_schema(&conn).expect("ensure_schema");

        let tags = vec![
            Tag {
                id: "tag-1".to_string(),
                kind: renote_storage::TagKind::Important,
                label: "Important".to_string(),
                color: "#ff0000".to_string(),
                checked: None,
            },
            Tag {
                id: "tag-2".to_string(),
                kind: renote_storage::TagKind::ToDo,
                label: "To Do".to_string(),
                color: "#00ff00".to_string(),
                checked: None,
            },
        ];
        index_tags(&conn, "notebook-1", &tags).expect("index_tags");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tag WHERE notebook_id = 'notebook-1'", [], |row| {
                row.get(0)
            })
            .expect("count tags");
        assert_eq!(count, 2);

        let kind: String = conn
            .query_row("SELECT kind FROM tag WHERE id = 'tag-2'", [], |row| row.get(0))
            .expect("read kind");
        assert_eq!(kind, "to-do");

        // Re-running with a smaller set replaces (not appends to) the prior rows.
        index_tags(&conn, "notebook-1", &tags[..1]).expect("index_tags again");
        let count_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM tag WHERE notebook_id = 'notebook-1'", [], |row| {
                row.get(0)
            })
            .expect("count tags after");
        assert_eq!(count_after, 1);
    }

    #[test]
    fn extract_wikilink_targets_finds_wikilink_marks_in_a_text_box() {
        let text_object = PageObjectEnvelope {
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
                                    "text": "Recipes",
                                    "marks": [{ "kind": "wikilink", "attr": "page-recipes", "attr2": "Recipes" }]
                                },
                                { "text": " and ", "marks": [] },
                                {
                                    "text": "Groceries",
                                    "marks": [{ "kind": "wikilink", "attr": "page-groceries", "attr2": "Groceries" }]
                                },
                            ],
                            "listKind": "none",
                            "indentLevel": 0,
                            "tagId": null
                        }
                    ]
                }
            }),
        };

        let ink_object = PageObjectEnvelope {
            id: "obj-2".to_string(),
            r#type: "ink-stroke".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({ "kind": "wikilink", "attr": "should-not-appear" }),
        };

        let mut targets = extract_wikilink_targets(&[text_object, ink_object]);
        targets.sort();
        assert_eq!(targets, vec!["page-groceries".to_string(), "page-recipes".to_string()]);
    }

    #[test]
    fn extract_wikilink_targets_dedupes_but_keeps_a_self_referencing_target() {
        let text_object = PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "text-box".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({
                "content": {
                    "paragraphs": [
                        {
                            "runs": [
                                { "text": "A", "marks": [{ "kind": "wikilink", "attr": "page-self" }] },
                                { "text": "B", "marks": [{ "kind": "wikilink", "attr": "page-self" }] },
                            ],
                            "listKind": "none",
                            "indentLevel": 0,
                            "tagId": null
                        }
                    ]
                }
            }),
        };

        // A page's own id is passed in as the target here to model a self-link (the page links
        // to itself) — extract_wikilink_targets has no notion of "this page's own id" to filter
        // against, so a self-link simply appears once, same as any other deduped target.
        let targets = extract_wikilink_targets(&[text_object]);
        assert_eq!(targets, vec!["page-self".to_string()]);
    }

    #[test]
    fn list_backlinks_and_list_page_links_query_page_link_rows() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        crate::schema::ensure_schema(&conn).expect("ensure_schema");

        conn.execute(
            "INSERT INTO page (id, notebook_id, section_id, parent_page_id, order_key, title, created_at, modified_at, section_dir) \
             VALUES ('page-a', 'nb-1', 'sec-1', NULL, 'a0', 'Page A', 't', 't', '/tmp/a')",
            [],
        )
        .expect("insert page-a");
        conn.execute(
            "INSERT INTO page (id, notebook_id, section_id, parent_page_id, order_key, title, created_at, modified_at, section_dir) \
             VALUES ('page-b', 'nb-1', 'sec-1', NULL, 'a1', 'Page B', 't', 't', '/tmp/b')",
            [],
        )
        .expect("insert page-b");

        conn.execute(
            "INSERT INTO page_link (source_page_id, target_page_id) VALUES ('page-a', 'page-b')",
            [],
        )
        .expect("insert link a->b");
        conn.execute(
            "INSERT INTO page_link (source_page_id, target_page_id) VALUES ('page-a', 'page-a')",
            [],
        )
        .expect("insert self link a->a");

        let backlinks_to_b = list_backlinks(&conn, "page-b").expect("list_backlinks b");
        assert_eq!(backlinks_to_b, vec!["page-a".to_string()]);

        let backlinks_to_a = list_backlinks(&conn, "page-a").expect("list_backlinks a");
        assert_eq!(
            backlinks_to_a,
            vec!["page-a".to_string()],
            "a self-link is a valid backlink to itself"
        );

        let mut links = list_page_links(&conn, "nb-1").expect("list_page_links");
        links.sort();
        let mut expected = vec![
            ("page-a".to_string(), "page-a".to_string()),
            ("page-a".to_string(), "page-b".to_string()),
        ];
        expected.sort();
        assert_eq!(links, expected);

        let links_other_notebook =
            list_page_links(&conn, "nb-2").expect("list_page_links other notebook");
        assert!(links_other_notebook.is_empty());
    }

    #[test]
    fn list_tagged_paragraphs_scopes_by_notebook_and_tag_and_orders_recent_page_first() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        crate::schema::ensure_schema(&conn).expect("ensure_schema");

        conn.execute(
            "INSERT INTO page (id, notebook_id, section_id, parent_page_id, order_key, title, created_at, modified_at, section_dir) \
             VALUES ('page-old', 'nb-1', 'sec-1', NULL, 'a0', 'Older Page', 't', '2024-01-01T00:00:00Z', '/tmp/old')",
            [],
        )
        .expect("insert page-old");
        conn.execute(
            "INSERT INTO page (id, notebook_id, section_id, parent_page_id, order_key, title, created_at, modified_at, section_dir) \
             VALUES ('page-new', 'nb-1', 'sec-1', NULL, 'a1', 'Newer Page', 't', '2024-06-01T00:00:00Z', '/tmp/new')",
            [],
        )
        .expect("insert page-new");
        conn.execute(
            "INSERT INTO page (id, notebook_id, section_id, parent_page_id, order_key, title, created_at, modified_at, section_dir) \
             VALUES ('page-other-nb', 'nb-2', 'sec-2', NULL, 'a0', 'Other Notebook Page', 't', '2024-06-01T00:00:00Z', '/tmp/other')",
            [],
        )
        .expect("insert page-other-nb");

        conn.execute(
            "INSERT INTO paragraph_tag (page_id, object_id, paragraph_index, tag_id, text) \
             VALUES ('page-old', 'obj-1', 0, 'tag-todo', 'Buy milk')",
            [],
        )
        .expect("insert tagged paragraph (old page)");
        conn.execute(
            "INSERT INTO paragraph_tag (page_id, object_id, paragraph_index, tag_id, text) \
             VALUES ('page-new', 'obj-2', 0, 'tag-todo', 'Call Alex')",
            [],
        )
        .expect("insert tagged paragraph (new page)");
        conn.execute(
            "INSERT INTO paragraph_tag (page_id, object_id, paragraph_index, tag_id, text) \
             VALUES ('page-new', 'obj-3', 1, 'tag-other', 'Unrelated tag')",
            [],
        )
        .expect("insert differently-tagged paragraph");
        conn.execute(
            "INSERT INTO paragraph_tag (page_id, object_id, paragraph_index, tag_id, text) \
             VALUES ('page-other-nb', 'obj-4', 0, 'tag-todo', 'Different notebook')",
            [],
        )
        .expect("insert tagged paragraph (other notebook)");

        let rows =
            list_tagged_paragraphs(&conn, "nb-1", "tag-todo").expect("list_tagged_paragraphs");

        assert_eq!(rows.len(), 2, "only nb-1's tag-todo rows, not tag-other or nb-2's");
        assert_eq!(rows[0].page_id, "page-new", "more recently modified page sorts first");
        assert_eq!(rows[0].page_title, "Newer Page");
        assert_eq!(rows[0].object_id, "obj-2");
        assert_eq!(rows[0].text, "Call Alex");
        assert_eq!(rows[1].page_id, "page-old");
        assert_eq!(rows[1].text, "Buy milk");
    }
}
