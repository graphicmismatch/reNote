//! End-to-end, black-box tests against renote-storage's public API only:
//! create a notebook -> section -> page -> write page objects (including a
//! real ink-stroke with a binary point blob) -> read it all back and
//! assert full round-trip equality, plus deletion tests confirming
//! notebook/section/page removal actually clears the filesystem.

use std::path::Path;

use renote_storage::{
    create_notebook, create_page, create_section, create_section_group, delete_notebook,
    delete_page, delete_section, delete_section_group, empty_trash, empty_trash_entry,
    list_notebooks, list_pages, list_section_groups, list_sections, list_trash, page_json_path,
    read_asset, read_page, read_stroke_blob, restore_from_trash, section_dir, section_group_dir,
    trash_notebook, trash_section, trash_section_group, write_asset, write_page, write_stroke_blob,
    Bounds, PageBackground, PageObjectEnvelope, PageRuleLines, Transform2D, TrashItemKind,
};

fn sample_transform() -> Transform2D {
    Transform2D { x: 12.5, y: -4.0, rotation: 0.0, scale_x: 1.0, scale_y: 1.0, z_index: 3.0 }
}

fn sample_bounds() -> Bounds {
    Bounds { x: 0.0, y: 0.0, width: 200.0, height: 80.0 }
}

#[test]
fn full_notebook_section_page_object_roundtrip() {
    let root = tempfile::tempdir().expect("tempdir");

    // 1. Create a notebook.
    let notebook = create_notebook(root.path(), "My Notebook", Some("#ff0000".to_string()))
        .expect("create_notebook");
    assert_eq!(notebook.name, "My Notebook");
    assert!(Path::new(&notebook.path).is_dir());

    let listed_notebooks = list_notebooks(root.path()).expect("list_notebooks");
    assert_eq!(listed_notebooks, vec![notebook.clone()]);

    // 2. Create a section directly under the notebook root.
    let notebook_dir = Path::new(&notebook.path).to_path_buf();
    let section = create_section(
        &notebook_dir,
        &notebook.id,
        None,
        "Section A",
        Some("#00ff00".to_string()),
        "a0",
    )
    .expect("create_section");
    assert_eq!(section.notebook_id, notebook.id);

    let listed_sections = list_sections(&notebook_dir).expect("list_sections");
    assert_eq!(listed_sections, vec![section.clone()]);

    let section_folder = section_dir(&notebook_dir, &section.id);
    assert!(section_folder.is_dir());

    // 2b. Create a section group under the notebook, with its own nested
    //     section inside it, and confirm groups/sections nest arbitrarily
    //     without cross-contaminating listings at the wrong level.
    let group = create_section_group(&notebook_dir, &notebook.id, None, "Group 1", "b0")
        .expect("create_section_group");
    let group_folder = section_group_dir(&notebook_dir, &group.id);
    assert!(group_folder.is_dir());

    let nested_section = create_section(
        &group_folder,
        &notebook.id,
        Some(group.id.clone()),
        "Nested Section",
        None,
        "a0",
    )
    .expect("create_section (nested)");

    assert_eq!(
        list_section_groups(&notebook_dir).expect("list_section_groups"),
        vec![group.clone()]
    );
    assert_eq!(
        list_sections(&group_folder).expect("list_sections (nested)"),
        vec![nested_section.clone()]
    );
    // The nested section must NOT surface when listing sections at the
    // notebook level — only its own immediate parent folder's children do.
    assert_eq!(
        list_sections(&notebook_dir).expect("list_sections (top-level)"),
        vec![section.clone()]
    );

    // 3. Create a page inside the section.
    let mut page = create_page(
        &section_folder,
        &section.id,
        None,
        "a0",
        "My Page",
        PageBackground { color: None, rule_lines: PageRuleLines::CollegeRuled },
        None,
    )
    .expect("create_page");
    assert_eq!(page.section_id, section.id);
    assert_eq!(page.title, "My Page");
    assert!(page_json_path(&section_folder, &page.id).is_file());

    // 4. Write a real binary ink-stroke point blob and reference it from an
    //    ink-stroke PageObjectEnvelope, plus a plain text-box object.
    let stroke_points =
        vec![(0.0_f32, 0.0, 0.0), (10.0, 5.5, 0.4), (20.0, 12.0, 0.8), (30.5, 9.25, 1.0)];
    let stroke_asset_path =
        write_stroke_blob(&section_folder, &page.id, "stroke-1", &stroke_points)
            .expect("write_stroke_blob");
    assert_eq!(stroke_asset_path, format!("assets/{}/strokes/stroke-1.bin", page.id));

    let ink_object = PageObjectEnvelope {
        id: "object-1".to_string(),
        r#type: "ink-stroke".to_string(),
        transform: sample_transform(),
        bounds: sample_bounds(),
        data: serde_json::json!({
            "tool": "pen",
            "color": "#000000",
            "width": 2.0,
            "pointDataAssetPath": stroke_asset_path,
        }),
    };

    let text_object = PageObjectEnvelope {
        id: "object-2".to_string(),
        r#type: "text-box".to_string(),
        transform: sample_transform(),
        bounds: sample_bounds(),
        data: serde_json::json!({
            "content": { "doc": "opaque-rich-text-blob", "version": 1 },
        }),
    };

    // A generic asset file (image bytes) written via `write_asset`,
    // referenced from an `image` object's `data.assetPath`.
    let image_bytes = b"fake-png-bytes".to_vec();
    let image_asset_path =
        write_asset(&section_folder, &page.id, "photo.png", &image_bytes).expect("write_asset");
    let image_object = PageObjectEnvelope {
        id: "object-3".to_string(),
        r#type: "image".to_string(),
        transform: sample_transform(),
        bounds: sample_bounds(),
        data: serde_json::json!({
            "assetPath": image_asset_path,
            "naturalWidth": 800,
            "naturalHeight": 600,
            "cropRect": null,
        }),
    };

    let objects = vec![ink_object.clone(), text_object.clone(), image_object.clone()];
    write_page(&section_folder, &mut page, &objects).expect("write_page");

    // 5. Read the page back and assert full round-trip equality of
    //    metadata, objects, and the binary stroke blob.
    let doc = read_page(&section_folder, &page.id).expect("read_page");
    assert_eq!(doc.page, page);
    assert_eq!(doc.objects, objects);

    let read_back_points =
        read_stroke_blob(&section_folder, &stroke_asset_path).expect("read_stroke_blob");
    assert_eq!(read_back_points, stroke_points);

    let read_back_image = read_asset(&section_folder, &image_asset_path).expect("read_asset");
    assert_eq!(read_back_image, image_bytes);

    let listed_pages = list_pages(&section_folder).expect("list_pages");
    assert_eq!(listed_pages, vec![page.clone()]);

    // Print the exact page.json contents produced, for documentation
    // purposes (visible with `cargo test -- --nocapture`).
    let raw = std::fs::read_to_string(page_json_path(&section_folder, &page.id)).unwrap();
    println!("--- sample page.json ---\n{raw}\n--- end sample page.json ---");

    // 6. Delete the page, section group, section, then the notebook,
    //    confirming each is actually gone from disk afterward.
    delete_page(&section_folder, &page.id).expect("delete_page");
    assert!(!page_json_path(&section_folder, &page.id).exists());
    assert!(!renote_storage::page_assets_dir(&section_folder, &page.id).exists());

    delete_section_group(&notebook_dir, &group.id).expect("delete_section_group");
    assert!(!group_folder.exists());
    assert!(list_section_groups(&notebook_dir)
        .expect("list_section_groups after delete")
        .is_empty());

    delete_section(&notebook_dir, &section.id).expect("delete_section");
    assert!(!section_folder.exists());

    delete_notebook(&notebook_dir).expect("delete_notebook");
    assert!(!notebook_dir.exists());
    assert!(list_notebooks(root.path()).expect("list_notebooks after delete").is_empty());
}

/// Exercises the exact read-mutate-write pattern `renote_commands::page::update_page_background`
/// uses (read the full document, change only `page.background`, write back the SAME objects
/// list unchanged) — this is the regression `update_page_background` exists to avoid: a
/// background-only edit must never perturb the page's object list or any other metadata field
/// besides `background`/`modifiedAt`.
#[test]
fn updating_only_the_background_leaves_objects_and_other_metadata_untouched() {
    let root = tempfile::tempdir().expect("tempdir");

    let notebook =
        create_notebook(root.path(), "Background Test Notebook", None).expect("create_notebook");
    let notebook_dir = Path::new(&notebook.path).to_path_buf();
    let section = create_section(&notebook_dir, &notebook.id, None, "Section A", None, "a0")
        .expect("create_section");
    let section_folder = section_dir(&notebook_dir, &section.id);

    let mut page = create_page(
        &section_folder,
        &section.id,
        None,
        "a0",
        "A page with a background to change",
        PageBackground { color: None, rule_lines: PageRuleLines::None },
        None,
    )
    .expect("create_page");

    let ink_object = PageObjectEnvelope {
        id: "object-1".to_string(),
        r#type: "ink-stroke".to_string(),
        transform: sample_transform(),
        bounds: sample_bounds(),
        data: serde_json::json!({
            "tool": "pen",
            "color": "#000000",
            "width": 2.0,
            "pointDataAssetPath": "assets/irrelevant/strokes/stroke-1.bin",
        }),
    };
    let text_object = PageObjectEnvelope {
        id: "object-2".to_string(),
        r#type: "text-box".to_string(),
        transform: sample_transform(),
        bounds: sample_bounds(),
        data: serde_json::json!({ "content": { "doc": "opaque-rich-text-blob", "version": 1 } }),
    };
    let objects = vec![ink_object, text_object];

    write_page(&section_folder, &mut page, &objects).expect("write_page (initial)");
    let original_created_at = page.created_at.clone();
    let original_id = page.id.clone();
    let original_title = page.title.clone();
    let original_modified_at = page.modified_at.clone();

    // --- Simulate `update_page_background`: read the full document fresh, mutate ONLY
    //     `background`, and write back the exact same `objects` slice the read returned. ---
    let doc = read_page(&section_folder, &page.id).expect("read_page before background update");
    let mut updated_page = doc.page;
    let objects_from_read = doc.objects;
    assert_eq!(objects_from_read, objects, "objects read back must match what was written");

    let new_background =
        PageBackground { color: Some("#0b1d33".to_string()), rule_lines: PageRuleLines::Graph };
    updated_page.background = new_background.clone();
    write_page(&section_folder, &mut updated_page, &objects_from_read)
        .expect("write_page (background-only update)");

    // --- Re-read and assert: background changed, modifiedAt advanced, EVERYTHING else
    //     (including the full objects list, byte-for-byte) is untouched. ---
    let after = read_page(&section_folder, &page.id).expect("read_page after background update");
    assert_eq!(after.page.background, new_background);
    assert_eq!(after.page.id, original_id);
    assert_eq!(after.page.title, original_title);
    assert_eq!(after.page.created_at, original_created_at);
    assert_ne!(
        after.page.modified_at, original_modified_at,
        "modifiedAt must advance on any write_page call, including a background-only one"
    );
    assert_eq!(
        after.objects, objects,
        "objects list must be byte-identical after a background-only update"
    );
}

/// Trash/restore round-trips for all four kinds a recycle bin covers, plus
/// `empty_trash`. `.renote-trash/` lives at the library root, a sibling of
/// notebook folders — `list_notebooks` never sees it (it only picks up
/// folders carrying a `.renote-notebook.json` marker), which is what keeps
/// trashed items out of anything that scans the notebook tree.
#[test]
fn trash_and_restore_round_trips_for_section_group_section_and_notebook() {
    let root = tempfile::tempdir().expect("tempdir");

    let notebook =
        create_notebook(root.path(), "Trash Test Notebook", None).expect("create_notebook");
    let notebook_dir = Path::new(&notebook.path).to_path_buf();

    let section = create_section(&notebook_dir, &notebook.id, None, "Doomed Section", None, "a0")
        .expect("create_section");
    let section_folder = section_dir(&notebook_dir, &section.id);
    create_page(
        &section_folder,
        &section.id,
        None,
        "a0",
        "A page inside the doomed section",
        PageBackground { color: None, rule_lines: PageRuleLines::None },
        None,
    )
    .expect("create_page inside doomed section");

    let group = create_section_group(&notebook_dir, &notebook.id, None, "Doomed Group", "b0")
        .expect("create_section_group");
    let group_folder = section_group_dir(&notebook_dir, &group.id);

    // --- Section: trash, confirm gone, restore, confirm back with its page intact. ---
    let section_entry =
        trash_section(root.path(), &section_folder, &section).expect("trash_section");
    assert_eq!(section_entry.kind, TrashItemKind::Section);
    assert!(!section_folder.exists(), "section folder must be moved out, not copied");
    assert_eq!(list_sections(&notebook_dir).expect("list_sections after trash").len(), 0);

    let trash_entries = list_trash(root.path()).expect("list_trash");
    assert!(trash_entries.iter().any(|e| e.id == section_entry.id));

    restore_from_trash(root.path(), &section_entry.id, &notebook_dir)
        .expect("restore_from_trash (section)");
    assert!(section_folder.is_dir(), "section folder restored to its original location");
    assert_eq!(
        list_sections(&notebook_dir).expect("list_sections after restore"),
        vec![section.clone()]
    );
    let restored_pages = list_pages(&section_folder).expect("list_pages after restore");
    assert_eq!(restored_pages.len(), 1, "the page inside the section survived the round trip");

    // --- Section group: trash, confirm gone, restore, confirm back. ---
    let group_entry =
        trash_section_group(root.path(), &group_folder, &group).expect("trash_section_group");
    assert_eq!(group_entry.kind, TrashItemKind::SectionGroup);
    assert!(!group_folder.exists());
    assert_eq!(
        list_section_groups(&notebook_dir).expect("list_section_groups after trash").len(),
        0
    );

    restore_from_trash(root.path(), &group_entry.id, &notebook_dir)
        .expect("restore_from_trash (section group)");
    assert!(group_folder.is_dir());
    assert_eq!(
        list_section_groups(&notebook_dir).expect("list_section_groups after restore"),
        vec![group.clone()]
    );

    // --- empty_trash_entry: permanently removes just one entry. ---
    let throwaway_group =
        create_section_group(&notebook_dir, &notebook.id, None, "Throwaway", "c0")
            .expect("create_section_group (throwaway)");
    let throwaway_entry = trash_section_group(
        root.path(),
        &section_group_dir(&notebook_dir, &throwaway_group.id),
        &throwaway_group,
    )
    .expect("trash_section_group (throwaway)");
    empty_trash_entry(root.path(), &throwaway_entry.id).expect("empty_trash_entry");
    assert!(list_trash(root.path())
        .expect("list_trash after empty_trash_entry")
        .iter()
        .all(|e| e.id != throwaway_entry.id));

    // --- Notebook: trash, confirm gone from list_notebooks, restore, confirm back. ---
    let notebook_entry =
        trash_notebook(root.path(), &notebook_dir, &notebook).expect("trash_notebook");
    assert_eq!(notebook_entry.kind, TrashItemKind::Notebook);
    assert!(!notebook_dir.exists());
    assert!(list_notebooks(root.path())
        .expect("list_notebooks after trashing notebook")
        .is_empty());

    restore_from_trash(root.path(), &notebook_entry.id, root.path())
        .expect("restore_from_trash (notebook)");
    assert!(notebook_dir.is_dir(), "notebook restored under its original folder name");
    assert_eq!(
        list_notebooks(root.path()).expect("list_notebooks after restoring notebook"),
        vec![notebook.clone()]
    );

    // --- empty_trash: wipes everything remaining, regardless of how much is in there. ---
    trash_section(root.path(), &section_dir(&notebook_dir, &section.id), &section)
        .expect("trash_section (for empty_trash coverage)");
    assert!(!list_trash(root.path()).expect("list_trash before empty_trash").is_empty());
    empty_trash(root.path()).expect("empty_trash");
    assert!(list_trash(root.path()).expect("list_trash after empty_trash").is_empty());
}
