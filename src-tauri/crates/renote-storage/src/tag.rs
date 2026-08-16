//! Notebook-scoped tag create/list/update/delete, plus cascade-clearing a
//! deleted tag's id off every paragraph that referenced it.
//!
//! The canonical tag list is per-notebook (not workspace-global — matches
//! every other scoping decision in this app: sections/pages/the index are
//! all per-notebook), stored as `<notebook_dir>/tags.json` holding
//! `{ schemaVersion, tags: Tag[] }`. Mirrors `notebook.rs`'s list/create
//! shape and uses the same `json_io` helpers.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::StorageError;
use crate::model::{Tag, TagKind};
use crate::{json_io, util};

const TAGS_FILE: &str = "tags.json";

/// The current on-disk schema version for `tags.json`. No upgrader chain
/// exists yet (this is the first version ever written) — carried from day
/// one per the same convention `page.rs`'s `CURRENT_PAGE_SCHEMA_VERSION`
/// establishes, so a future shape change has somewhere to hook in.
const CURRENT_TAGS_SCHEMA_VERSION: u32 = 1;

/// The full on-disk shape of `<notebook_dir>/tags.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TagsFile {
    schema_version: u32,
    tags: Vec<Tag>,
}

impl Default for TagsFile {
    fn default() -> Self {
        Self { schema_version: CURRENT_TAGS_SCHEMA_VERSION, tags: Vec::new() }
    }
}

fn tags_file_path(notebook_dir: &Path) -> std::path::PathBuf {
    notebook_dir.join(TAGS_FILE)
}

/// Reads `<notebook_dir>/tags.json`. Returns an empty list — not an error —
/// if the file doesn't exist yet, mirroring `notebook::list_notebooks`'s
/// treatment of a missing root directory.
fn read_tags_file(notebook_dir: &Path) -> Result<TagsFile, StorageError> {
    let path = tags_file_path(notebook_dir);
    match json_io::read_json(&path) {
        Ok(file) => Ok(file),
        Err(StorageError::Io { source, .. }) if source.kind() == std::io::ErrorKind::NotFound => {
            Ok(TagsFile::default())
        }
        Err(err) => Err(err),
    }
}

fn write_tags_file(notebook_dir: &Path, file: &TagsFile) -> Result<(), StorageError> {
    json_io::write_json(&tags_file_path(notebook_dir), file)
}

/// Lists every tag defined for the notebook at `notebook_dir`, in on-disk
/// order. Returns an empty vec if no `tags.json` exists yet.
pub fn list_tags(notebook_dir: &Path) -> Result<Vec<Tag>, StorageError> {
    Ok(read_tags_file(notebook_dir)?.tags)
}

/// Creates a new tag and appends it to the notebook's `tags.json`.
pub fn create_tag(
    notebook_dir: &Path,
    kind: TagKind,
    label: &str,
    color: &str,
) -> Result<Tag, StorageError> {
    let mut file = read_tags_file(notebook_dir)?;
    let tag = Tag {
        id: util::new_id(),
        kind,
        label: label.to_string(),
        color: color.to_string(),
        checked: None,
    };
    file.tags.push(tag.clone());
    write_tags_file(notebook_dir, &file)?;
    Ok(tag)
}

/// Updates an existing tag's `label`/`color`. `kind` and `id` are not
/// updatable (a tag's kind is fixed at creation, matching the "built-in
/// kind vs. custom" distinction `packages/core`'s `TagKind` union encodes).
pub fn update_tag(
    notebook_dir: &Path,
    tag_id: &str,
    label: &str,
    color: &str,
) -> Result<Tag, StorageError> {
    let mut file = read_tags_file(notebook_dir)?;
    let tag = file
        .tags
        .iter_mut()
        .find(|t| t.id == tag_id)
        .ok_or_else(|| tag_not_found(notebook_dir, tag_id))?;
    tag.label = label.to_string();
    tag.color = color.to_string();
    let updated = tag.clone();
    write_tags_file(notebook_dir, &file)?;
    Ok(updated)
}

/// Deletes a tag from `tags.json`, then cascade-clears its id off every
/// paragraph that referenced it: walks every section/page under
/// `notebook_dir` (through this crate's own `list_sections`/`list_pages`/
/// `read_page`/`write_page` — never touching files directly, the same
/// discipline `renote-index`'s `rebuild_from_scan` follows) and, for every
/// `text-box`/`table` object whose opaque `data` JSON contains a `tagId`
/// field equal to `tag_id`, nulls it out and re-saves the page.
///
/// Deletion is not blocked by existing references — the tag simply stops
/// existing and every paragraph that had it reverts to untagged.
pub fn delete_tag(notebook_dir: &Path, tag_id: &str) -> Result<(), StorageError> {
    let mut file = read_tags_file(notebook_dir)?;
    let before = file.tags.len();
    file.tags.retain(|t| t.id != tag_id);
    if file.tags.len() == before {
        return Err(tag_not_found(notebook_dir, tag_id));
    }
    write_tags_file(notebook_dir, &file)?;

    cascade_clear_tag(notebook_dir, tag_id)
}

fn tag_not_found(notebook_dir: &Path, tag_id: &str) -> StorageError {
    StorageError::Io {
        path: tags_file_path(notebook_dir),
        source: std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("tag not found: {tag_id}"),
        ),
    }
}

/// Walks every section (recursively through nested section-groups) and
/// every page under `notebook_dir`, rewriting any `tagId` field equal to
/// `tag_id` found anywhere inside a `text-box`/`table` object's opaque
/// `data` JSON to `null`, and re-saving pages that changed.
fn cascade_clear_tag(notebook_dir: &Path, tag_id: &str) -> Result<(), StorageError> {
    walk_dir_clearing_tag(notebook_dir, tag_id)
}

fn walk_dir_clearing_tag(dir: &Path, tag_id: &str) -> Result<(), StorageError> {
    for section in crate::section::list_sections(dir)? {
        let section_dir = crate::section::section_dir(dir, &section.id);
        for page_meta in crate::page::list_pages(&section_dir)? {
            let mut doc = crate::page::read_page(&section_dir, &page_meta.id)?;
            let mut changed = false;
            for object in &mut doc.objects {
                if (object.r#type == "text-box" || object.r#type == "table")
                    && clear_tag_id_in_value(&mut object.data, tag_id)
                {
                    changed = true;
                }
            }
            if changed {
                crate::page::write_page(&section_dir, &mut doc.page, &doc.objects)?;
            }
        }
    }

    for group in crate::section::list_section_groups(dir)? {
        let group_dir = crate::section::section_group_dir(dir, &group.id);
        walk_dir_clearing_tag(&group_dir, tag_id)?;
    }

    Ok(())
}

/// Generic recursive JSON walk: finds every object node with a `"tagId"`
/// key whose value is a string equal to `tag_id`, and rewrites it to
/// `null`. Deliberately does NOT deserialize into a concrete rich-text
/// type — this crate has zero dependency on `packages/text-editor` and
/// must stay that way (see `renote-index::page_index::extract_plain_text`'s
/// doc comment for the same discipline on the index side). Returns whether
/// anything was changed.
fn clear_tag_id_in_value(value: &mut serde_json::Value, tag_id: &str) -> bool {
    let mut changed = false;
    match value {
        serde_json::Value::Object(map) => {
            if let Some(existing) = map.get("tagId") {
                if existing.as_str() == Some(tag_id) {
                    map.insert("tagId".to_string(), serde_json::Value::Null);
                    changed = true;
                }
            }
            for v in map.values_mut() {
                if clear_tag_id_in_value(v, tag_id) {
                    changed = true;
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                if clear_tag_id_in_value(item, tag_id) {
                    changed = true;
                }
            }
        }
        _ => {}
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Bounds, PageBackground, PageObjectEnvelope, PageRuleLines, Transform2D};

    fn sample_transform() -> Transform2D {
        Transform2D { x: 0.0, y: 0.0, rotation: 0.0, scale_x: 1.0, scale_y: 1.0, z_index: 0.0 }
    }

    fn sample_bounds() -> Bounds {
        Bounds { x: 0.0, y: 0.0, width: 10.0, height: 10.0 }
    }

    #[test]
    fn round_trips_tags_json_through_create_and_list() {
        let dir = tempfile::tempdir().expect("tempdir");

        let tag =
            create_tag(dir.path(), TagKind::Important, "Important", "#ff0000").expect("create_tag");
        assert_eq!(tag.kind, TagKind::Important);
        assert_eq!(tag.label, "Important");
        assert_eq!(tag.color, "#ff0000");

        let listed = list_tags(dir.path()).expect("list_tags");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0], tag);
    }

    #[test]
    fn missing_tags_file_returns_empty_list() {
        let dir = tempfile::tempdir().expect("tempdir");
        let listed = list_tags(dir.path()).expect("list_tags");
        assert!(listed.is_empty());
    }

    #[test]
    fn update_tag_changes_label_and_color_but_not_kind_or_id() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tag = create_tag(dir.path(), TagKind::ToDo, "To Do", "#00ff00").expect("create_tag");

        let updated = update_tag(dir.path(), &tag.id, "Done", "#0000ff").expect("update_tag");
        assert_eq!(updated.id, tag.id);
        assert_eq!(updated.kind, TagKind::ToDo);
        assert_eq!(updated.label, "Done");
        assert_eq!(updated.color, "#0000ff");

        let listed = list_tags(dir.path()).expect("list_tags");
        assert_eq!(listed, vec![updated]);
    }

    #[test]
    fn update_tag_errors_on_unknown_id() {
        let dir = tempfile::tempdir().expect("tempdir");
        let err = update_tag(dir.path(), "no-such-tag", "x", "#000000").unwrap_err();
        assert!(matches!(err, StorageError::Io { .. }));
    }

    #[test]
    fn delete_tag_removes_it_from_the_list() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tag = create_tag(dir.path(), TagKind::Idea, "Idea", "#ffff00").expect("create_tag");
        delete_tag(dir.path(), &tag.id).expect("delete_tag");
        assert!(list_tags(dir.path()).expect("list_tags").is_empty());
    }

    #[test]
    fn delete_tag_errors_on_unknown_id() {
        let dir = tempfile::tempdir().expect("tempdir");
        let err = delete_tag(dir.path(), "no-such-tag").unwrap_err();
        assert!(matches!(err, StorageError::Io { .. }));
    }

    /// The core regression this module exists to prevent: deleting a tag
    /// must null out `tagId` on every paragraph that referenced it (inside
    /// a text-box's rich-text content), across every section/page in the
    /// notebook, while leaving the paragraph's other content (and any
    /// other object) untouched.
    #[test]
    fn delete_tag_cascade_clears_paragraph_references_across_pages() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tag =
            create_tag(dir.path(), TagKind::Question, "Question", "#123456").expect("create_tag");

        let section =
            crate::section::create_section(dir.path(), "notebook-1", None, "Ideas", None, "a0")
                .expect("create_section");
        let section_dir = crate::section::section_dir(dir.path(), &section.id);

        // Page 1: a text-box paragraph tagged with the tag being deleted, plus an
        // untagged paragraph that must survive unchanged.
        let mut page_one = crate::page::create_page(
            &section_dir,
            &section.id,
            None,
            "a0",
            "Page One",
            PageBackground { color: None, rule_lines: PageRuleLines::None },
            None,
        )
        .expect("create_page one");
        let objects_one = vec![PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "text-box".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({
                "content": {
                    "paragraphs": [
                        { "runs": [{ "text": "Tagged paragraph", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": tag.id },
                        { "runs": [{ "text": "Untagged paragraph", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": null }
                    ]
                }
            }),
        }];
        crate::page::write_page(&section_dir, &mut page_one, &objects_one).expect("write_page one");

        // Page 2: a table cell tagged with the same tag, to prove the walk covers
        // "table" objects too, not just "text-box".
        let mut page_two = crate::page::create_page(
            &section_dir,
            &section.id,
            None,
            "a1",
            "Page Two",
            PageBackground { color: None, rule_lines: PageRuleLines::None },
            None,
        )
        .expect("create_page two");
        let objects_two = vec![PageObjectEnvelope {
            id: "obj-2".to_string(),
            r#type: "table".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({
                "columnWidths": [100.0],
                "rowHeights": [20.0],
                "cells": [[{
                    "paragraphs": [
                        { "runs": [{ "text": "Cell text", "marks": [] }], "listKind": "none", "indentLevel": 0, "tagId": tag.id }
                    ]
                }]],
                "mergedRanges": []
            }),
        }];
        crate::page::write_page(&section_dir, &mut page_two, &objects_two).expect("write_page two");

        delete_tag(dir.path(), &tag.id).expect("delete_tag");

        let reloaded_one =
            crate::page::read_page(&section_dir, &page_one.id).expect("read_page one");
        let content_one = &reloaded_one.objects[0].data["content"]["paragraphs"];
        assert_eq!(content_one[0]["tagId"], serde_json::Value::Null);
        assert_eq!(content_one[0]["runs"][0]["text"], "Tagged paragraph");
        assert_eq!(content_one[1]["tagId"], serde_json::Value::Null);
        assert_eq!(content_one[1]["runs"][0]["text"], "Untagged paragraph");

        let reloaded_two =
            crate::page::read_page(&section_dir, &page_two.id).expect("read_page two");
        let cell = &reloaded_two.objects[0].data["cells"][0][0]["paragraphs"][0];
        assert_eq!(cell["tagId"], serde_json::Value::Null);
        assert_eq!(cell["runs"][0]["text"], "Cell text");

        // The tag itself is gone from tags.json.
        assert!(list_tags(dir.path()).expect("list_tags").is_empty());
    }

    /// Deleting a tag must not touch a *different* tag's assignments.
    #[test]
    fn delete_tag_leaves_other_tags_assignments_untouched() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tag_a = create_tag(dir.path(), TagKind::Important, "A", "#111111").expect("tag a");
        let tag_b = create_tag(dir.path(), TagKind::Idea, "B", "#222222").expect("tag b");

        let section =
            crate::section::create_section(dir.path(), "notebook-1", None, "Sec", None, "a0")
                .expect("create_section");
        let section_dir = crate::section::section_dir(dir.path(), &section.id);

        let mut page = crate::page::create_page(
            &section_dir,
            &section.id,
            None,
            "a0",
            "Page",
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
                        { "runs": [], "listKind": "none", "indentLevel": 0, "tagId": tag_b.id }
                    ]
                }
            }),
        }];
        crate::page::write_page(&section_dir, &mut page, &objects).expect("write_page");

        delete_tag(dir.path(), &tag_a.id).expect("delete_tag a");

        let reloaded = crate::page::read_page(&section_dir, &page.id).expect("read_page");
        assert_eq!(
            reloaded.objects[0].data["content"]["paragraphs"][0]["tagId"],
            serde_json::Value::String(tag_b.id.clone())
        );

        let remaining = list_tags(dir.path()).expect("list_tags");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, tag_b.id);
    }
}
