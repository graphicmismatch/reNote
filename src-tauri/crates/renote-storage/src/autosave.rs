//! Per-page autosave — a single, cross-session persisted safety-net
//! snapshot, distinct from the in-memory, in-session undo/redo command log
//! the frontend's `CommandStack` owns. This module implements:
//! - [`write_autosave`]: overwrites the page's ONE autosave slot with a
//!   full, self-contained copy of a [`PageDocument`] plus every asset file
//!   its objects reference. Called on a timer, at an interval the user
//!   picks in Settings (see `renote-commands::autosave::save_autosave`) —
//!   NOT on every content save, unlike this module's predecessor
//!   (`version.rs`), which kept an unbounded, per-save snapshot history.
//! - [`autosave_status`] / [`read_autosave`].
//!
//! ## Why an autosave must copy referenced assets, not just record paths
//! `crate::blob::write_stroke_blob` writes to a path keyed only by
//! `stroke_id` (`assets/<pageId>/strokes/<strokeId>.bin`) and overwrites it
//! in place on every call; `crate::asset::write_asset` similarly writes a
//! generic asset to a specific deduped path that a later delete can remove.
//! An autosave that only stored object envelopes (referencing these files
//! by path) would, after the live blob is later edited or erased, silently
//! resolve to the *current* (wrong or missing) blob instead of the state at
//! autosave time. So [`write_autosave`] copies every asset file the
//! snapshotted objects reference into the autosave's own private folder,
//! making it fully self-contained.
//!
//! ## On-disk layout
//! ```text
//! <section_dir>/.renote-autosave/<page_id>/
//!   snapshot.json       {timestamp, page, objects} — see `SnapshotFile`
//!   assets/...          copies of every asset file referenced by
//!                       snapshot.json's objects, at the SAME relative path
//!                       they have under section_dir (e.g.
//!                       assets/<pageId>/strokes/<strokeId>.bin)
//! ```
//! `.renote-autosave/` sits as a sibling of `assets/` (not nested inside
//! it — that's user content) and of `.renote-index/` (derived/rebuildable,
//! the opposite property an autosave needs) directly under `section_dir`.
//!
//! ## Path-rewriting design choice
//! `write_stroke_blob`/`write_asset` already choose each asset's FINAL
//! relative path at write time (a stroke blob's path is a fixed function of
//! `page_id`/`stroke_id`; a generic asset's path is deduped via
//! `util::unique_file_name` into one particular, stable name). That means
//! the autosave's own copy of an asset and the live current copy always
//! share the exact same relative-to-`section_dir` path string — only the
//! BYTES at that path can differ over time. So both [`write_autosave`]
//! (copying live -> autosave) and [`read_autosave`]'s restore-time copy-back
//! (autosave -> live) are a plain "copy these bytes onto this same relative
//! path", and `snapshot.json`'s own `pointDataAssetPath`/`assetPath` values
//! never need rewriting in either direction.
//!
//! ## Retention
//! There is no retention cap to enforce: [`write_autosave`] prunes every file
//! the new snapshot doesn't reference, so at most one autosave ever exists per
//! page at a time.
//!
//! ## Why the folder isn't just wiped and re-copied each tick
//! Autosave runs on a timer. Re-copying every referenced asset each tick means
//! a 20MB audio clip is a 20MB copy per interval, which makes autosave the
//! slowest thing in the app. Only `ink-stroke` blobs are overwritten in place
//! (`write_stroke_blob` keys the path on `stroke_id` alone); everything
//! `write_asset` produces gets a fresh deduped name per write and is therefore
//! immutable, so an existing copy of it can never be stale. So stroke blobs
//! are re-copied every tick and other assets are copied once.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::StorageError;
use crate::json_io;
use crate::model::{Page, PageObjectEnvelope};
use crate::page::PageDocument;
use crate::util;

/// Sibling of `assets/`/`.renote-index/` directly under a section folder;
/// see this module's on-disk-layout doc comment above.
pub const AUTOSAVE_DIR_NAME: &str = ".renote-autosave";

const SNAPSHOT_FILE: &str = "snapshot.json";

/// Cheap status metadata for a page's autosave, without deserializing its
/// full `PageDocument` object data (see [`autosave_status`]).
#[derive(Debug, Clone, PartialEq)]
pub struct AutosaveMeta {
    /// The ISO 8601 timestamp the autosave was last taken at.
    pub timestamp: String,
    /// Total size in bytes of everything in the autosave folder
    /// (`snapshot.json` plus every copied asset file).
    pub size_bytes: u64,
    pub object_count: usize,
}

/// The on-disk shape of `snapshot.json`. Deliberately its own struct rather
/// than reusing `PageDocument`'s `#[serde(flatten)]` shape: nesting a
/// second flatten works, but a plain, explicit `page`/`objects` split is
/// simpler to read and is scoped only to this module's own file format
/// anyway — an autosave's JSON has no need to be byte-shaped like a live
/// `.page.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotFile {
    timestamp: String,
    page: Page,
    objects: Vec<PageObjectEnvelope>,
}

/// Just enough of `SnapshotFile` to report status cheaply: the timestamp
/// and object count, without paying to fully deserialize every object's
/// `data` value.
#[derive(Debug, Deserialize)]
struct SnapshotFileMetaOnly {
    timestamp: String,
    objects: Vec<serde_json::Value>,
}

fn page_autosave_dir(section_dir: &Path, page_id: &str) -> PathBuf {
    section_dir.join(AUTOSAVE_DIR_NAME).join(page_id)
}

/// Extracts every asset-referencing relative path (relative to
/// `section_dir`) off one object's opaque `data`, per the small fixed set
/// of known asset-reference fields: `InkStrokeData.pointDataAssetPath` and
/// `ImageData`/`FileAttachmentData`/`AudioClipData`'s shared `assetPath` —
/// see `packages/core/src/page-object/built-in-types.ts`. `table` objects
/// (and any other/unknown type) have no asset references. These are known,
/// stable field names per known object types, so a direct field lookup is
/// enough — no need for a generic opaque-value walk here.
fn asset_paths_for_object(object: &PageObjectEnvelope) -> Vec<String> {
    let field = match object.r#type.as_str() {
        "ink-stroke" => "pointDataAssetPath",
        "image" | "file-attachment" | "audio-clip" => "assetPath",
        _ => return Vec::new(),
    };
    object
        .data
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .into_iter()
        .collect()
}

fn copy_file(src: &Path, dest: &Path) -> Result<(), StorageError> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|source| StorageError::Io { path: parent.to_path_buf(), source })?;
    }
    std::fs::copy(src, dest)
        .map_err(|source| StorageError::Io { path: src.to_path_buf(), source })?;
    Ok(())
}

/// Recursively sums the byte size of every file under `dir`.
fn dir_size_bytes(dir: &Path) -> Result<u64, StorageError> {
    let mut total = 0u64;
    for entry in walkdir::WalkDir::new(dir) {
        let entry = entry.map_err(|err| {
            let path = err.path().unwrap_or(dir).to_path_buf();
            StorageError::Io { path, source: std::io::Error::from(err) }
        })?;
        if entry.file_type().is_file() {
            total += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    Ok(total)
}

/// Overwrites `page_id`'s ONE autosave slot with a full, self-contained
/// snapshot of `doc`, copying every asset file its objects reference (see
/// this module's doc comment). Any previous autosave for this page is
/// deleted first, so at most one ever exists on disk at a time.
pub fn write_autosave(
    section_dir: &Path,
    page_id: &str,
    doc: &PageDocument,
) -> Result<(), StorageError> {
    let autosave_dir = page_autosave_dir(section_dir, page_id);
    std::fs::create_dir_all(&autosave_dir)
        .map_err(|source| StorageError::Io { path: autosave_dir.clone(), source })?;

    let timestamp = util::now_iso8601();
    let file = SnapshotFile { timestamp, page: doc.page.clone(), objects: doc.objects.clone() };
    json_io::write_json(&autosave_dir.join(SNAPSHOT_FILE), &file)?;

    let mut keep: HashSet<PathBuf> = HashSet::new();
    keep.insert(autosave_dir.join(SNAPSHOT_FILE));

    for object in &doc.objects {
        for rel_path in asset_paths_for_object(object) {
            let dest = autosave_dir.join(&rel_path);
            keep.insert(dest.clone());

            let src = section_dir.join(&rel_path);
            if !src.is_file() {
                // Referenced asset missing live (shouldn't normally happen)
                // -- skip rather than failing the whole autosave over it. Any
                // copy this autosave already holds stays (it's the only
                // surviving copy, and restoring it puts the asset back).
                continue;
            }
            if object.r#type == "ink-stroke" || !dest.is_file() {
                copy_file(&src, &dest)?;
            }
        }
    }

    prune_unreferenced(&autosave_dir, &keep)
}

/// Deletes every file under `autosave_dir` that the autosave just written
/// doesn't reference, which is what keeps the "exactly one autosave slot"
/// property now that [`write_autosave`] no longer clears the folder outright.
/// Empty directories are left behind: they're a fixed, bounded set of asset
/// folder names per page, and removing them buys nothing.
fn prune_unreferenced(autosave_dir: &Path, keep: &HashSet<PathBuf>) -> Result<(), StorageError> {
    for entry in walkdir::WalkDir::new(autosave_dir).into_iter().filter_map(Result::ok) {
        if entry.file_type().is_file() && !keep.contains(entry.path()) {
            std::fs::remove_file(entry.path())
                .map_err(|source| StorageError::Io { path: entry.path().to_path_buf(), source })?;
        }
    }
    Ok(())
}

/// Reports whether `page_id` has an autosave, and if so its timestamp/size/
/// object count. Returns `None` if the page has no `.renote-autosave/<page_id>/`
/// folder yet, rather than erroring (matching `list_pages`/`list_trash`'s
/// not-found-is-empty convention for a not-yet-created root).
pub fn autosave_status(
    section_dir: &Path,
    page_id: &str,
) -> Result<Option<AutosaveMeta>, StorageError> {
    let autosave_dir = page_autosave_dir(section_dir, page_id);
    let snapshot_json = autosave_dir.join(SNAPSHOT_FILE);

    let meta_only: SnapshotFileMetaOnly = match json_io::read_json(&snapshot_json) {
        Ok(meta) => meta,
        Err(StorageError::Io { source, .. }) if source.kind() == std::io::ErrorKind::NotFound => {
            return Ok(None);
        }
        Err(err) => return Err(err),
    };
    let size_bytes = dir_size_bytes(&autosave_dir)?;

    Ok(Some(AutosaveMeta {
        timestamp: meta_only.timestamp,
        size_bytes,
        object_count: meta_only.objects.len(),
    }))
}

/// Reads the autosave back, copying its own copies of every referenced
/// asset file onto the LIVE `section_dir` location (same relative path —
/// see this module's path-rewriting doc comment), so the returned
/// `PageDocument`'s objects reference currently-valid, already-restored
/// assets and can be handed directly to `write_page` by the caller. This
/// keeps the restore command itself simple: "read the autosave, save it as
/// the current page" with no separate asset-restoration step.
pub fn read_autosave(section_dir: &Path, page_id: &str) -> Result<PageDocument, StorageError> {
    let autosave_dir = page_autosave_dir(section_dir, page_id);
    let snapshot_json = autosave_dir.join(SNAPSHOT_FILE);
    let file: SnapshotFile = json_io::read_json(&snapshot_json)?;

    for object in &file.objects {
        for rel_path in asset_paths_for_object(object) {
            let src = autosave_dir.join(&rel_path);
            if !src.is_file() {
                // The autosave itself never captured this asset (e.g. it
                // was already missing live at autosave time) -- nothing to
                // restore for it.
                continue;
            }
            let dest = section_dir.join(&rel_path);
            copy_file(&src, &dest)?;
        }
    }

    Ok(PageDocument { page: file.page, objects: file.objects })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::asset::write_asset;
    use crate::blob::write_stroke_blob;
    use crate::model::{Bounds, PageBackground, PageRuleLines, Transform2D};
    use crate::page::{create_page, read_page, write_page};

    fn sample_transform() -> Transform2D {
        Transform2D { x: 0.0, y: 0.0, rotation: 0.0, scale_x: 1.0, scale_y: 1.0, z_index: 0.0 }
    }

    fn sample_bounds() -> Bounds {
        Bounds { x: 0.0, y: 0.0, width: 10.0, height: 10.0 }
    }

    fn make_page(section_dir: &Path) -> Page {
        create_page(
            section_dir,
            "section-1",
            None,
            "a0",
            "Test Page",
            PageBackground { color: None, rule_lines: PageRuleLines::None },
            None,
        )
        .expect("create_page")
    }

    #[test]
    fn round_trips_write_status_read() {
        let dir = tempfile::tempdir().expect("tempdir");
        let section_dir = dir.path();
        let page = make_page(section_dir);

        let stroke_path = write_stroke_blob(section_dir, &page.id, "stroke-1", &[(1.0, 2.0, 0.5)])
            .expect("write_stroke_blob");
        let object = PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "ink-stroke".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({ "pointDataAssetPath": stroke_path }),
        };
        let doc = PageDocument { page: page.clone(), objects: vec![object] };

        write_autosave(section_dir, &page.id, &doc).expect("write_autosave");

        let status = autosave_status(section_dir, &page.id).expect("autosave_status");
        let meta = status.expect("autosave exists");
        assert_eq!(meta.object_count, 1);
        assert!(meta.size_bytes > 0);

        let read_back = read_autosave(section_dir, &page.id).expect("read_autosave");
        assert_eq!(read_back.objects.len(), 1);
        assert_eq!(read_back.page.title, "Test Page");
    }

    #[test]
    fn autosave_status_is_none_when_page_has_no_autosave_yet() {
        let dir = tempfile::tempdir().expect("tempdir");
        let status = autosave_status(dir.path(), "no-such-page").expect("autosave_status");
        assert!(status.is_none());
    }

    /// The core "keep only one at a time" property: writing a second
    /// autosave must fully replace the first, not accumulate alongside it —
    /// both in `snapshot.json` content AND on disk (no leftover asset
    /// copies from an object the newer autosave no longer references).
    #[test]
    fn a_second_autosave_replaces_the_first_entirely() {
        let dir = tempfile::tempdir().expect("tempdir");
        let section_dir = dir.path();
        let page = make_page(section_dir);

        let first_object = PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "text-box".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({ "text": "first" }),
        };
        write_autosave(
            section_dir,
            &page.id,
            &PageDocument { page: page.clone(), objects: vec![first_object] },
        )
        .expect("write_autosave 1");

        let asset_path =
            write_asset(section_dir, &page.id, "photo.png", b"second-bytes").expect("write_asset");
        let second_object = PageObjectEnvelope {
            id: "obj-2".to_string(),
            r#type: "image".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({ "assetPath": asset_path }),
        };
        write_autosave(
            section_dir,
            &page.id,
            &PageDocument { page: page.clone(), objects: vec![second_object] },
        )
        .expect("write_autosave 2");

        let read_back = read_autosave(section_dir, &page.id).expect("read_autosave");
        assert_eq!(read_back.objects.len(), 1, "only the second autosave's objects survive");
        assert_eq!(
            read_back.objects[0].data.get("assetPath").and_then(|v| v.as_str()),
            Some(asset_path.as_str()),
        );

        // No leftover directory entries from the first autosave's asset-free content.
        let autosave_dir = page_autosave_dir(section_dir, &page.id);
        let entries: Vec<_> = walkdir::WalkDir::new(&autosave_dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| e.path().to_path_buf())
            .collect();
        assert_eq!(entries.len(), 2, "only snapshot.json + the second autosave's one asset file");
    }

    /// Mirrors `version.rs`'s original regression test: a stroke blob is
    /// autosaved, then the SAME stroke id's blob is overwritten in place
    /// (as `write_stroke_blob` always does) with different points. The
    /// autosave's own copy must still read back the OLD points.
    #[test]
    fn autosave_survives_a_later_overwrite_of_the_same_stroke_blob() {
        let dir = tempfile::tempdir().expect("tempdir");
        let section_dir = dir.path();
        let page = make_page(section_dir);

        let old_points = vec![(1.0_f32, 1.0, 1.0)];
        let stroke_path =
            write_stroke_blob(section_dir, &page.id, "stroke-1", &old_points).expect("write");
        let object = PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "ink-stroke".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({ "pointDataAssetPath": stroke_path.clone() }),
        };
        let doc = PageDocument { page: page.clone(), objects: vec![object] };
        write_autosave(section_dir, &page.id, &doc).expect("write_autosave");

        // Overwrite the SAME stroke id's blob with new points, simulating
        // an edit after the autosave was taken.
        let new_points = vec![(9.0_f32, 9.0, 9.0), (10.0, 10.0, 10.0)];
        write_stroke_blob(section_dir, &page.id, "stroke-1", &new_points).expect("overwrite");

        // Live blob now has the new points.
        let live = crate::blob::read_stroke_blob(section_dir, &stroke_path).expect("read live");
        assert_eq!(live, new_points);

        // But the autosave's own copy must still have the OLD points.
        let restored = read_autosave(section_dir, &page.id).expect("read_autosave");
        let restored_path = restored.objects[0]
            .data
            .get("pointDataAssetPath")
            .and_then(|v| v.as_str())
            .expect("path present");
        // read_autosave copies the autosave's asset back onto the live path,
        // so re-reading the live path now reflects the OLD (restored) points.
        let after_restore_copy_back =
            crate::blob::read_stroke_blob(section_dir, restored_path).expect("read after restore");
        assert_eq!(after_restore_copy_back, old_points);
    }

    /// The autosave-cost fix: a repeat autosave re-copies mutable `ink-stroke`
    /// blobs but skips immutable `write_asset` assets it already holds. Proven
    /// by tampering with both of the autosave's own copies and re-running: the
    /// stroke blob comes back overwritten from live, the image copy doesn't.
    #[test]
    fn a_repeat_autosave_recopies_stroke_blobs_but_not_immutable_assets() {
        let dir = tempfile::tempdir().expect("tempdir");
        let section_dir = dir.path();
        let page = make_page(section_dir);

        let stroke_path = write_stroke_blob(section_dir, &page.id, "stroke-1", &[(1.0, 1.0, 1.0)])
            .expect("write_stroke_blob");
        let asset_path =
            write_asset(section_dir, &page.id, "photo.png", b"image-bytes").expect("write_asset");
        let objects = vec![
            PageObjectEnvelope {
                id: "obj-1".to_string(),
                r#type: "ink-stroke".to_string(),
                transform: sample_transform(),
                bounds: sample_bounds(),
                data: serde_json::json!({ "pointDataAssetPath": stroke_path.clone() }),
            },
            PageObjectEnvelope {
                id: "obj-2".to_string(),
                r#type: "image".to_string(),
                transform: sample_transform(),
                bounds: sample_bounds(),
                data: serde_json::json!({ "assetPath": asset_path.clone() }),
            },
        ];
        let doc = PageDocument { page: page.clone(), objects };
        write_autosave(section_dir, &page.id, &doc).expect("write_autosave 1");

        let autosave_dir = page_autosave_dir(section_dir, &page.id);
        std::fs::write(autosave_dir.join(&stroke_path), b"tampered").expect("tamper stroke");
        std::fs::write(autosave_dir.join(&asset_path), b"tampered").expect("tamper asset");

        write_autosave(section_dir, &page.id, &doc).expect("write_autosave 2");

        assert_ne!(
            std::fs::read(autosave_dir.join(&stroke_path)).unwrap(),
            b"tampered",
            "stroke blobs are mutable, so every autosave must re-copy them",
        );
        assert_eq!(
            std::fs::read(autosave_dir.join(&asset_path)).unwrap(),
            b"tampered",
            "immutable assets must not be re-copied on every autosave tick",
        );
    }

    #[test]
    fn restoring_the_autosave_recreates_a_deleted_generic_asset() {
        let dir = tempfile::tempdir().expect("tempdir");
        let section_dir = dir.path();
        let page = make_page(section_dir);

        let asset_path = write_asset(section_dir, &page.id, "photo.png", b"original-bytes")
            .expect("write_asset");
        let object = PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "image".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({ "assetPath": asset_path.clone() }),
        };
        let doc = PageDocument { page: page.clone(), objects: vec![object] };
        write_autosave(section_dir, &page.id, &doc).expect("write_autosave");

        // Delete the live asset entirely.
        crate::asset::delete_asset(section_dir, &asset_path).expect("delete_asset");
        assert!(crate::asset::read_asset(section_dir, &asset_path).is_err());

        read_autosave(section_dir, &page.id).expect("read_autosave");
        let recreated = crate::asset::read_asset(section_dir, &asset_path).expect("recreated");
        assert_eq!(recreated, b"original-bytes");
    }

    #[test]
    fn full_restore_flow_reverts_content_via_write_page() {
        let dir = tempfile::tempdir().expect("tempdir");
        let section_dir = dir.path();
        let mut page = make_page(section_dir);

        let old_points = vec![(1.0_f32, 1.0, 1.0)];
        let stroke_path =
            write_stroke_blob(section_dir, &page.id, "stroke-1", &old_points).expect("write");
        let object = PageObjectEnvelope {
            id: "obj-1".to_string(),
            r#type: "ink-stroke".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({ "pointDataAssetPath": stroke_path.clone() }),
        };
        write_page(section_dir, &mut page, std::slice::from_ref(&object)).expect("write_page");
        let doc = PageDocument { page: page.clone(), objects: vec![object.clone()] };
        write_autosave(section_dir, &page.id, &doc).expect("write_autosave");

        // Simulate the stroke later being edited (overwritten) AND a new
        // object being added, then "restore" the autosave the same way the
        // command layer does: read_autosave then write_page.
        write_stroke_blob(section_dir, &page.id, "stroke-1", &[(9.0, 9.0, 9.0)]).expect("edit");
        let mut live_page = read_page(section_dir, &page.id).expect("read_page").page;
        let new_object = PageObjectEnvelope {
            id: "obj-2".to_string(),
            r#type: "text-box".to_string(),
            transform: sample_transform(),
            bounds: sample_bounds(),
            data: serde_json::json!({ "text": "added after autosave" }),
        };
        write_page(section_dir, &mut live_page, &[object.clone(), new_object]).expect("write_page");
        assert_eq!(read_page(section_dir, &page.id).expect("read_page").objects.len(), 2);

        let restored_doc = read_autosave(section_dir, &page.id).expect("read_autosave");
        let mut page_to_write = restored_doc.page.clone();
        write_page(section_dir, &mut page_to_write, &restored_doc.objects).expect("write_page");

        let after_restore = read_page(section_dir, &page.id).expect("read_page");
        assert_eq!(after_restore.objects.len(), 1, "restore reverts to the old object list");
        let restored_stroke_path = after_restore.objects[0]
            .data
            .get("pointDataAssetPath")
            .and_then(|v| v.as_str())
            .expect("path present");
        let points = crate::blob::read_stroke_blob(section_dir, restored_stroke_path)
            .expect("read restored stroke");
        assert_eq!(points, old_points, "restore reverts the stroke's points too");
    }
}
