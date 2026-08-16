//! Black-box round-trip tests for notebook backup/restore, against
//! `renote_storage`'s public API only (see `full_roundtrip.rs` for the same
//! convention applied to the rest of the crate).

use std::path::Path;

use renote_storage::{
    create_notebook, create_notebook_archive, create_page, create_section, list_notebooks,
    list_pages, list_sections, read_asset, read_page, read_stroke_blob, restore_notebook_archive,
    section_dir, write_asset, write_autosave, write_page, write_stroke_blob, Notebook,
    PageBackground, PageDocument, PageObjectEnvelope, PageRuleLines, Transform2D,
};

fn sample_transform() -> Transform2D {
    Transform2D { x: 1.0, y: 2.0, rotation: 0.0, scale_x: 1.0, scale_y: 1.0, z_index: 0.0 }
}

fn sample_bounds() -> renote_storage::Bounds {
    renote_storage::Bounds { x: 0.0, y: 0.0, width: 100.0, height: 50.0 }
}

/// Builds a notebook with a section, a page carrying an ink-stroke object
/// (binary blob) and an image asset, plus a `.renote-index/` folder holding
/// junk content standing in for a real SQLite index file — the thing a
/// backup archive must exclude. Returns the notebook and the section id.
fn build_sample_notebook(root: &Path, name: &str) -> (Notebook, String) {
    let notebook =
        create_notebook(root, name, Some("#123456".to_string())).expect("create_notebook");
    let notebook_dir = Path::new(&notebook.path).to_path_buf();

    let section = create_section(&notebook_dir, &notebook.id, None, "Section A", None, "a0")
        .expect("create_section");
    let sec_dir = section_dir(&notebook_dir, &section.id);

    let mut page = create_page(
        &sec_dir,
        &section.id,
        None,
        "p0",
        "My Page",
        PageBackground { color: None, rule_lines: PageRuleLines::None },
        None,
    )
    .expect("create_page");

    let stroke_asset_path = write_stroke_blob(&sec_dir, &page.id, "stroke-1", &[(1.0, 2.0, 0.5)])
        .expect("write_stroke_blob");
    let photo_asset_path =
        write_asset(&sec_dir, &page.id, "photo.png", b"fake-png-bytes").expect("write_asset");

    let object = PageObjectEnvelope {
        id: "obj-1".to_string(),
        r#type: "ink-stroke".to_string(),
        transform: sample_transform(),
        bounds: sample_bounds(),
        data: serde_json::json!({
            "pointDataAssetPath": stroke_asset_path,
            "photoAssetPath": photo_asset_path,
        }),
    };
    write_page(&sec_dir, &mut page, &[object]).expect("write_page");

    // Stand-in for a real derived index — must never survive into the archive.
    let index_dir = notebook_dir.join(".renote-index");
    std::fs::create_dir_all(&index_dir).expect("mkdir .renote-index");
    std::fs::write(index_dir.join("index.sqlite"), b"not a real sqlite file")
        .expect("write index stub");

    (notebook, section.id)
}

#[test]
fn archive_then_restore_reproduces_notebook_contents_and_excludes_index() {
    let root = tempfile::tempdir().expect("tempdir");
    let (notebook, _section_id) = build_sample_notebook(root.path(), "Backup Me");
    let notebook_dir = Path::new(&notebook.path).to_path_buf();

    let archive_path = root.path().join("backup.zip");
    create_notebook_archive(&notebook_dir, &archive_path).expect("create_notebook_archive");
    assert!(archive_path.is_file());

    // Restore into a *different* library root, simulating "restore on another
    // machine" — nothing about restore should depend on the original path.
    let restore_root = tempfile::tempdir().expect("tempdir");
    let restored = restore_notebook_archive(restore_root.path(), &archive_path)
        .expect("restore_notebook_archive");

    assert_eq!(restored.name, notebook.name);
    assert_eq!(restored.color, notebook.color);
    assert_ne!(restored.path, notebook.path, "restored notebook lives at a new location");

    let restored_dir = Path::new(&restored.path).to_path_buf();
    assert!(!restored_dir.join(".renote-index").exists(), "derived index must not be archived");

    let listed = list_notebooks(restore_root.path()).expect("list_notebooks");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, notebook.id, "restore preserves the notebook's own id");

    let sections = list_sections(&restored_dir).expect("list_sections");
    assert_eq!(sections.len(), 1);
    let restored_section_dir = section_dir(&restored_dir, &sections[0].id);
    let pages = list_pages(&restored_section_dir).expect("list_pages");
    assert_eq!(pages.len(), 1);

    let restored_doc = read_page(&restored_section_dir, &pages[0].id).expect("read_page");
    assert_eq!(restored_doc.page.title, "My Page");
    assert_eq!(restored_doc.objects.len(), 1);
    assert_eq!(restored_doc.objects[0].id, "obj-1");

    let point_asset_path = restored_doc.objects[0]
        .data
        .get("pointDataAssetPath")
        .and_then(|v| v.as_str())
        .expect("pointDataAssetPath present")
        .to_string();
    let photo_asset_path = restored_doc.objects[0]
        .data
        .get("photoAssetPath")
        .and_then(|v| v.as_str())
        .expect("photoAssetPath present")
        .to_string();

    let blob = read_stroke_blob(&restored_section_dir, &point_asset_path)
        .expect("read_stroke_blob after restore");
    assert_eq!(blob, vec![(1.0, 2.0, 0.5)]);

    let asset_bytes =
        read_asset(&restored_section_dir, &photo_asset_path).expect("read_asset after restore");
    assert_eq!(asset_bytes, b"fake-png-bytes");
}

#[test]
fn restoring_the_same_archive_twice_creates_two_separate_notebooks() {
    let root = tempfile::tempdir().expect("tempdir");
    let (notebook, _section_id) = build_sample_notebook(root.path(), "Dup Me");
    let notebook_dir = Path::new(&notebook.path).to_path_buf();

    let archive_path = root.path().join("backup.zip");
    create_notebook_archive(&notebook_dir, &archive_path).expect("create_notebook_archive");

    let restore_root = tempfile::tempdir().expect("tempdir");
    let first = restore_notebook_archive(restore_root.path(), &archive_path).expect("restore #1");
    let second = restore_notebook_archive(restore_root.path(), &archive_path).expect("restore #2");

    assert_ne!(first.path, second.path, "second restore must not clobber the first");
    assert_eq!(first.name, second.name);

    let listed = list_notebooks(restore_root.path()).expect("list_notebooks");
    assert_eq!(listed.len(), 2, "both restores must produce independently listable notebooks");
}

#[test]
fn restoring_a_non_notebook_archive_fails_cleanly() {
    let root = tempfile::tempdir().expect("tempdir");
    let bogus_path = root.path().join("not-a-notebook.zip");
    {
        let file = std::fs::File::create(&bogus_path).expect("create bogus zip");
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("readme.txt", zip::write::SimpleFileOptions::default()).expect("start_file");
        use std::io::Write;
        zip.write_all(b"just some text, not a notebook").expect("write_all");
        zip.finish().expect("finish");
    }

    let restore_root = tempfile::tempdir().expect("tempdir");
    let result = restore_notebook_archive(restore_root.path(), &bogus_path);
    assert!(
        result.is_err(),
        "a zip with no .renote-notebook.json must not be accepted as a backup"
    );

    // No partial/staging leftovers under the library root after a failed restore.
    let entries: Vec<_> =
        std::fs::read_dir(restore_root.path()).expect("read_dir").filter_map(|e| e.ok()).collect();
    assert!(entries.is_empty(), "a failed restore must not leave staging debris behind");
}

/// A notebook with a page's autosave present (carrying its own copied asset
/// files, per `renote_storage::autosave`'s design) must still produce a
/// small archive that excludes `.renote-autosave/` entirely — see
/// `backup.rs`'s module doc comment for why autosave is deliberately not a
/// backup concern.
#[test]
fn archive_excludes_autosave_and_stays_small() {
    let root = tempfile::tempdir().expect("tempdir");
    let (notebook, section_id) = build_sample_notebook(root.path(), "Autosaved");
    let notebook_dir = Path::new(&notebook.path).to_path_buf();
    let sec_dir = section_dir(&notebook_dir, &section_id);

    let pages = list_pages(&sec_dir).expect("list_pages");
    let page_id = pages[0].id.clone();
    let doc = read_page(&sec_dir, &page_id).expect("read_page");

    write_autosave(
        &sec_dir,
        &page_id,
        &PageDocument { page: doc.page.clone(), objects: doc.objects.clone() },
    )
    .expect("write_autosave");
    assert!(
        sec_dir.join(".renote-autosave").join(&page_id).is_dir(),
        "sanity: the autosave was actually written to disk"
    );

    let archive_path = root.path().join("backup.zip");
    create_notebook_archive(&notebook_dir, &archive_path).expect("create_notebook_archive");

    let file = std::fs::File::open(&archive_path).expect("open archive");
    let archive = zip::ZipArchive::new(file).expect("ZipArchive::new");
    let names: Vec<&str> = archive.file_names().collect();
    assert!(
        names.iter().all(|n| !n.contains(".renote-autosave")),
        "archive entries must never include .renote-autosave/, got: {names:?}"
    );

    let archive_size = std::fs::metadata(&archive_path).expect("archive metadata").len();
    assert!(
        archive_size < 20_000,
        "archive unexpectedly large ({archive_size} bytes) — the autosave may have leaked in"
    );
}

#[test]
fn archive_excludes_index_folder_from_zip_entries_directly() {
    let root = tempfile::tempdir().expect("tempdir");
    let (notebook, _section_id) = build_sample_notebook(root.path(), "Index Check");
    let notebook_dir = Path::new(&notebook.path).to_path_buf();

    let archive_path = root.path().join("backup.zip");
    create_notebook_archive(&notebook_dir, &archive_path).expect("create_notebook_archive");

    let file = std::fs::File::open(&archive_path).expect("open archive");
    let archive = zip::ZipArchive::new(file).expect("ZipArchive::new");
    let names: Vec<&str> = archive.file_names().collect();
    assert!(
        names.iter().all(|n| !n.starts_with(".renote-index")),
        "archive entries must never include .renote-index/, got: {names:?}"
    );
    assert!(names.iter().any(|n| n.ends_with(".renote-notebook.json")));
}
