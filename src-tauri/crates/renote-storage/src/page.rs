//! Page create/read/write/list/delete, plus the versioned schema-upgrade
//! dispatch that runs on every read.
//!
//! A page is a single `<pageId>.page.json` file directly inside its
//! section's folder (NOT its own subfolder — subpages are
//! `parentPageId`/`orderKey` relationships among siblings, not filesystem
//! nesting). Its binary/asset blobs live alongside it in
//! `assets/<pageId>/` (see `crate::asset` and `crate::blob`).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::asset;
use crate::autosave;
use crate::error::StorageError;
use crate::model::{Page, PageId, PageObjectEnvelope};
use crate::{json_io, util};

const PAGE_JSON_SUFFIX: &str = ".page.json";

/// The current on-disk schema version. Always written on save; checked and
/// upgraded-from on read via [`upgrade_to_current`].
pub const CURRENT_PAGE_SCHEMA_VERSION: u32 = 1;

/// The full on-disk shape of a `<pageId>.page.json` file: the `Page`
/// metadata fields flattened in at the top level, plus the ordered
/// `objects` array.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDocument {
    #[serde(flatten)]
    pub page: Page,
    pub objects: Vec<PageObjectEnvelope>,
}

/// The path a page with the given id's JSON file would live at, inside
/// `section_dir`.
pub fn page_json_path(section_dir: &Path, page_id: &str) -> PathBuf {
    section_dir.join(format!("{page_id}{PAGE_JSON_SUFFIX}"))
}

/// Creates a new page (with no objects yet) inside `section_dir` and its
/// empty `assets/<pageId>/` folder. Returns the new `Page` metadata.
pub fn create_page(
    section_dir: &Path,
    section_id: &str,
    parent_page_id: Option<PageId>,
    order_key: &str,
    title: &str,
    background: crate::model::PageBackground,
    template_id: Option<String>,
) -> Result<Page, StorageError> {
    std::fs::create_dir_all(section_dir)
        .map_err(|source| StorageError::Io { path: section_dir.to_path_buf(), source })?;

    let now = util::now_iso8601();
    let page = Page {
        id: util::new_id(),
        section_id: section_id.to_string(),
        parent_page_id,
        order_key: order_key.to_string(),
        title: title.to_string(),
        background,
        template_id,
        created_at: now.clone(),
        modified_at: now,
        schema_version: CURRENT_PAGE_SCHEMA_VERSION,
    };

    let doc = PageDocument { page: page.clone(), objects: Vec::new() };
    json_io::write_json(&page_json_path(section_dir, &page.id), &doc)?;
    std::fs::create_dir_all(asset::page_assets_dir(section_dir, &page.id)).map_err(|source| {
        StorageError::Io { path: asset::page_assets_dir(section_dir, &page.id), source }
    })?;

    Ok(page)
}

/// Reads a page's JSON file, applying [`upgrade_to_current`] first so
/// callers always get current-schema data regardless of what version was
/// on disk.
pub fn read_page(section_dir: &Path, page_id: &str) -> Result<PageDocument, StorageError> {
    let path = page_json_path(section_dir, page_id);
    let raw: serde_json::Value = json_io::read_json(&path)?;
    let upgraded = upgrade_to_current(raw)?;
    serde_json::from_value(upgraded).map_err(|source| StorageError::Json { path, source })
}

/// Overwrites a page's JSON file with `objects`, stamping `modifiedAt` to
/// now and `schemaVersion` to [`CURRENT_PAGE_SCHEMA_VERSION`] (mutating
/// `page` in place to reflect both).
pub fn write_page(
    section_dir: &Path,
    page: &mut Page,
    objects: &[PageObjectEnvelope],
) -> Result<(), StorageError> {
    page.modified_at = util::now_iso8601();
    page.schema_version = CURRENT_PAGE_SCHEMA_VERSION;

    let doc = PageDocument { page: page.clone(), objects: objects.to_vec() };
    json_io::write_json(&page_json_path(section_dir, &page.id), &doc)
}

/// Lists every page directly inside `section_dir` (i.e. every
/// `*.page.json` file), sorted by `orderKey`. Each entry is read through
/// [`read_page`], so results are always current-schema.
pub fn list_pages(section_dir: &Path) -> Result<Vec<Page>, StorageError> {
    let mut pages = Vec::new();

    let entries = match std::fs::read_dir(section_dir) {
        Ok(entries) => entries,
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => return Ok(pages),
        Err(source) => return Err(StorageError::Io { path: section_dir.to_path_buf(), source }),
    };

    for entry in entries {
        let entry =
            entry.map_err(|source| StorageError::Io { path: section_dir.to_path_buf(), source })?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(page_id) = file_name.strip_suffix(PAGE_JSON_SUFFIX) else {
            continue;
        };
        pages.push(read_page(section_dir, page_id)?.page);
    }

    pages.sort_by(|a, b| a.order_key.cmp(&b.order_key));
    Ok(pages)
}

/// Renames a page in place: updates its `title`, leaving objects untouched.
/// Goes through `read_page`/`write_page` (not a direct field patch) so the
/// same schema-upgrade-on-read and `modifiedAt`/`schemaVersion`-stamp-on-
/// write behavior every other page mutation gets applies here too, rather
/// than this becoming a second, subtly different way to touch page.json.
pub fn rename_page(section_dir: &Path, page_id: &str, title: &str) -> Result<Page, StorageError> {
    let doc = read_page(section_dir, page_id)?;
    let mut page = doc.page;
    page.title = title.to_string();
    write_page(section_dir, &mut page, &doc.objects)?;
    Ok(page)
}

/// Sets a page's `orderKey` in place, leaving everything else untouched —
/// how a drag-reorder within a section is persisted. Goes through
/// `read_page`/`write_page` for the same reason [`rename_page`] does.
pub fn set_page_order_key(
    section_dir: &Path,
    page_id: &str,
    order_key: &str,
) -> Result<Page, StorageError> {
    let doc = read_page(section_dir, page_id)?;
    let mut page = doc.page;
    page.order_key = order_key.to_string();
    write_page(section_dir, &mut page, &doc.objects)?;
    Ok(page)
}

/// Sets a page's `parentPageId` in place (Phase 11.4 indent/outdent) — `None` un-indents it to a
/// top-level page in its section. Same shape as [`rename_page`]/[`set_page_order_key`]; unlike
/// [`move_page`], this never touches `sectionId`, assets, or the page's own file location — a
/// subpage relationship is pure ordering metadata within one section (see the crate's module docs).
pub fn set_page_parent(
    section_dir: &Path,
    page_id: &str,
    parent_page_id: Option<PageId>,
) -> Result<Page, StorageError> {
    let doc = read_page(section_dir, page_id)?;
    let mut page = doc.page;
    page.parent_page_id = parent_page_id;
    write_page(section_dir, &mut page, &doc.objects)?;
    Ok(page)
}

/// Moves a page — its JSON, its `assets/<pageId>/` folder and its autosave
/// folder — into another section, which may live in another notebook. The
/// page keeps its id (a wikilink stores only that, so links into the page
/// survive the move) and takes `order_key`'s position in its new section.
///
/// Everything the page owns moves together or the move fails: the JSON is
/// written to the destination first and the source copy is removed last, so
/// an interrupted move leaves a duplicate rather than a hole. Assets and
/// autosave folders move by rename, which is atomic within one filesystem —
/// and a workspace is one directory tree, so both sides always are.
pub fn move_page(
    from_section_dir: &Path,
    to_section_dir: &Path,
    to_section_id: &str,
    page_id: &str,
    order_key: &str,
) -> Result<Page, StorageError> {
    let doc = read_page(from_section_dir, page_id)?;
    let mut page = doc.page;
    page.order_key = order_key.to_string();
    if page.section_id != to_section_id {
        page.section_id = to_section_id.to_string();
        // A subpage's parent stays behind in the old section, and a page can only be a subpage of
        // a sibling — so a moved page arrives as a top-level page rather than as an orphan
        // pointing at a parent that isn't there.
        page.parent_page_id = None;
    }
    write_page(to_section_dir, &mut page, &doc.objects)?;

    move_dir(
        &asset::page_assets_dir(from_section_dir, page_id),
        &asset::page_assets_dir(to_section_dir, page_id),
    )?;
    move_dir(
        &from_section_dir.join(autosave::AUTOSAVE_DIR_NAME).join(page_id),
        &to_section_dir.join(autosave::AUTOSAVE_DIR_NAME).join(page_id),
    )?;

    let source_json = page_json_path(from_section_dir, page_id);
    std::fs::remove_file(&source_json)
        .map_err(|source| StorageError::Io { path: source_json, source })?;
    Ok(page)
}

/// Renames `from` to `to`, creating `to`'s parent first. A no-op when `from`
/// doesn't exist — a page with no assets and no autosave yet is the common
/// case, not an error.
fn move_dir(from: &Path, to: &Path) -> Result<(), StorageError> {
    if !from.is_dir() {
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|source| StorageError::Io { path: parent.to_path_buf(), source })?;
    }
    std::fs::rename(from, to)
        .map_err(|source| StorageError::Io { path: from.to_path_buf(), source })
}

/// Deletes a page's JSON file and its `assets/<pageId>/` folder (ink
/// stroke blobs, images, audio, attachments — everything for that page).
pub fn delete_page(section_dir: &Path, page_id: &str) -> Result<(), StorageError> {
    let json_path = page_json_path(section_dir, page_id);
    if json_path.is_file() {
        std::fs::remove_file(&json_path)
            .map_err(|source| StorageError::Io { path: json_path, source })?;
    }

    let assets_dir = asset::page_assets_dir(section_dir, page_id);
    if assets_dir.is_dir() {
        std::fs::remove_dir_all(&assets_dir)
            .map_err(|source| StorageError::Io { path: assets_dir, source })?;
    }

    Ok(())
}

/// A function that upgrades one page-JSON `Value` from the version it
/// implicitly is (see [`upgrader_for_version`]) to the next version up.
type Upgrader = fn(serde_json::Value) -> Result<serde_json::Value, StorageError>;

/// Looks up the upgrader that carries a page JSON blob from `version` to
/// `version + 1`, or `None` if no such upgrader is registered (in which
/// case [`upgrade_to_current`] reports [`StorageError::UnsupportedSchemaVersion`]).
///
/// Currently registers one real upgrader: version 0 (pages written before
/// the `schemaVersion` field existed) -> version 1. This is the whole
/// chain today, but the dispatch mechanism itself — this function plus
/// [`upgrade_to_current`]'s loop — is real and exercised by a test, not a
/// stub, so adding version 2 later is one new match arm plus one new
/// function.
fn upgrader_for_version(version: u32) -> Option<Upgrader> {
    match version {
        0 => Some(upgrade_v0_to_v1),
        _ => None,
    }
}

/// Version 0 pages predate the `schemaVersion` field entirely; nothing
/// else about the document shape changed, so this upgrader only stamps
/// the field to 1.
fn upgrade_v0_to_v1(mut value: serde_json::Value) -> Result<serde_json::Value, StorageError> {
    if let Some(obj) = value.as_object_mut() {
        obj.insert("schemaVersion".to_string(), serde_json::json!(1));
    }
    Ok(value)
}

/// Reads `schemaVersion` off `value` (treating a missing field as version
/// 0) and repeatedly applies [`upgrader_for_version`] until it reaches
/// [`CURRENT_PAGE_SCHEMA_VERSION`].
fn upgrade_to_current(mut value: serde_json::Value) -> Result<serde_json::Value, StorageError> {
    let mut version =
        value.get("schemaVersion").and_then(serde_json::Value::as_u64).unwrap_or(0) as u32;

    if version > CURRENT_PAGE_SCHEMA_VERSION {
        // A page written by a newer app version than this one understands;
        // no downgrade path exists, so refuse rather than silently
        // mis-reading it.
        return Err(StorageError::UnsupportedSchemaVersion {
            found: version,
            current: CURRENT_PAGE_SCHEMA_VERSION,
        });
    }

    while version < CURRENT_PAGE_SCHEMA_VERSION {
        let upgrader =
            upgrader_for_version(version).ok_or(StorageError::UnsupportedSchemaVersion {
                found: version,
                current: CURRENT_PAGE_SCHEMA_VERSION,
            })?;
        value = upgrader(value)?;
        version += 1;
    }

    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::PageRuleLines;

    /// Constructs a fake "version 0" page-JSON blob (no `schemaVersion`
    /// field, as real pre-schema-version pages would have looked) and
    /// confirms the upgrade dispatch carries it to current version.
    #[test]
    fn upgrades_legacy_v0_page_to_current_version() {
        let legacy = serde_json::json!({
            "id": "page-1",
            "sectionId": "section-1",
            "parentPageId": null,
            "orderKey": "a0",
            "title": "Legacy page",
            "background": { "color": null, "ruleLines": "none" },
            "templateId": null,
            "createdAt": "2020-01-01T00:00:00Z",
            "modifiedAt": "2020-01-01T00:00:00Z",
            "objects": []
            // no "schemaVersion" field at all: this is what a v0 page looks like.
        });

        let upgraded = upgrade_to_current(legacy).expect("upgrade should succeed");
        assert_eq!(
            upgraded.get("schemaVersion").and_then(serde_json::Value::as_u64),
            Some(u64::from(CURRENT_PAGE_SCHEMA_VERSION))
        );

        let doc: PageDocument = serde_json::from_value(upgraded).expect("should deserialize");
        assert_eq!(doc.page.schema_version, CURRENT_PAGE_SCHEMA_VERSION);
        assert_eq!(doc.page.title, "Legacy page");
        assert_eq!(doc.page.background.rule_lines, PageRuleLines::None);
    }

    /// A `schemaVersion` newer than this build understands has no
    /// downgrade path, so it must be rejected rather than silently
    /// passed through unchanged.
    #[test]
    fn rejects_a_page_from_a_newer_schema_version() {
        let from_the_future =
            serde_json::json!({ "schemaVersion": CURRENT_PAGE_SCHEMA_VERSION + 1 });
        let err = upgrade_to_current(from_the_future).unwrap_err();
        assert!(matches!(err, StorageError::UnsupportedSchemaVersion { .. }));
    }

    /// A move has to carry everything the page owns: the JSON, its assets, and its autosave
    /// snapshot. Losing any of them is silent data loss the user only discovers later.
    #[test]
    fn move_page_carries_assets_and_autosave_and_leaves_nothing_behind() {
        let temp = tempfile::tempdir().expect("temp dir");
        let from = temp.path().join("section-a");
        let to = temp.path().join("section-b");

        let page = create_page(
            &from,
            "section-a",
            None,
            "00000000000000000001",
            "Notes",
            crate::model::PageBackground {
                color: None,
                rule_lines: crate::model::PageRuleLines::None,
            },
            None,
        )
        .expect("create");
        crate::asset::write_asset(&from, &page.id, "picture.png", b"pixels").expect("asset");
        std::fs::create_dir_all(from.join(autosave::AUTOSAVE_DIR_NAME).join(&page.id))
            .expect("autosave dir");
        std::fs::write(
            from.join(autosave::AUTOSAVE_DIR_NAME).join(&page.id).join("snapshot.json"),
            b"{}",
        )
        .expect("snapshot");

        let moved =
            move_page(&from, &to, "section-b", &page.id, "00000000000000000007").expect("move");

        assert_eq!(moved.id, page.id, "a moved page keeps its id, so wikilinks still resolve");
        assert_eq!(moved.section_id, "section-b");
        assert_eq!(moved.order_key, "00000000000000000007");
        assert!(to.join(format!("{}.page.json", page.id)).is_file());
        assert!(!from.join(format!("{}.page.json", page.id)).exists());
        assert!(crate::asset::page_assets_dir(&to, &page.id).join("picture.png").is_file());
        assert!(!crate::asset::page_assets_dir(&from, &page.id).exists());
        assert!(to
            .join(autosave::AUTOSAVE_DIR_NAME)
            .join(&page.id)
            .join("snapshot.json")
            .is_file());
        assert_eq!(list_pages(&from).expect("list from").len(), 0);
        assert_eq!(list_pages(&to).expect("list to").len(), 1);
    }

    /// Reordering rewrites only the key, and `list_pages` sorts by it.
    #[test]
    fn set_page_order_key_reorders_the_section() {
        let temp = tempfile::tempdir().expect("temp dir");
        let dir = temp.path().join("section");
        let background = crate::model::PageBackground {
            color: None,
            rule_lines: crate::model::PageRuleLines::None,
        };
        let first =
            create_page(&dir, "s", None, "00000000000000000001", "First", background.clone(), None)
                .expect("create first");
        let second =
            create_page(&dir, "s", None, "00000000000000000002", "Second", background, None)
                .expect("create second");

        set_page_order_key(&dir, &second.id, "00000000000000000000").expect("reorder");

        let ids: Vec<String> =
            list_pages(&dir).expect("list").into_iter().map(|page| page.id).collect();
        assert_eq!(ids, vec![second.id, first.id]);
    }

    #[test]
    fn set_page_parent_updates_parent_and_null_un_indents() {
        let temp = tempfile::tempdir().expect("temp dir");
        let dir = temp.path().join("section");
        let background = crate::model::PageBackground {
            color: None,
            rule_lines: crate::model::PageRuleLines::None,
        };
        let parent = create_page(
            &dir,
            "s",
            None,
            "00000000000000000001",
            "Parent",
            background.clone(),
            None,
        )
        .expect("create parent");
        let child = create_page(&dir, "s", None, "00000000000000000002", "Child", background, None)
            .expect("create child");
        assert_eq!(child.parent_page_id, None);

        let indented = set_page_parent(&dir, &child.id, Some(parent.id.clone())).expect("indent");
        assert_eq!(indented.parent_page_id, Some(parent.id.clone()));
        assert_eq!(read_page(&dir, &child.id).expect("read").page.parent_page_id, Some(parent.id));

        let outdented = set_page_parent(&dir, &child.id, None).expect("outdent");
        assert_eq!(outdented.parent_page_id, None);
    }
}
