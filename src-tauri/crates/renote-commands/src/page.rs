//! Page commands: thin wrappers delegating to `renote_storage` for the
//! actual read/write, syncing `renote_index` afterward so the derived
//! index never drifts from a write this crate makes on the frontend's
//! behalf.

use tauri::Runtime;

use crate::dto::{
    CreatePageRequestDto, ListPagesRequestDto, LoadPageObjectsRequestDto, MovePageRequestDto,
    PageDocumentDto, PageDto, RenamePageRequestDto, ReorderPagesRequestDto,
    SavePageObjectsRequestDto, SetPageParentRequestDto, UpdatePageBackgroundRequestDto,
};
use crate::{library, naming};

#[tauri::command]
pub fn list_pages<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ListPagesRequestDto,
) -> Result<Vec<PageDto>, String> {
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let pages = renote_storage::list_pages(&section_dir).map_err(|err| err.to_string())?;
    Ok(pages.into_iter().map(PageDto::from).collect())
}

#[tauri::command]
pub fn create_page<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: CreatePageRequestDto,
) -> Result<PageDto, String> {
    let (notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;

    // Suffixed rather than rejected when taken — see `naming`'s module docs.
    let title = naming::free_page_title(&section_dir, &request.title)?;

    // A template is just a page you copy (Phase 11.1): `templateId` doubles as the id of the
    // page to copy FROM — there's no separate template registry or file format, so "apply a
    // template" and "record which template a page came from" are the same field. Reads the
    // source page's OWN background rather than `request.background`, since a template's whole
    // point is that its look comes along with it.
    let template = request
        .template_id
        .as_ref()
        .map(|id| renote_storage::read_page(&section_dir, id))
        .transpose()
        .map_err(|err| err.to_string())?;

    let background = template
        .as_ref()
        .map_or_else(|| request.background.into(), |doc| doc.page.background.clone());

    let mut page = renote_storage::create_page(
        &section_dir,
        &request.section_id,
        request.parent_page_id,
        &request.order_key,
        &title,
        background,
        request.template_id,
    )
    .map_err(|err| err.to_string())?;

    let objects = match template {
        Some(doc) => copy_template_objects(&section_dir, &page.id, doc.objects)
            .map_err(|err| err.to_string())?,
        None => Vec::new(),
    };
    if !objects.is_empty() {
        renote_storage::write_page(&section_dir, &mut page, &objects)
            .map_err(|err| err.to_string())?;
    }

    let conn = renote_index::open_or_rebuild(std::path::Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::index_page(&conn, &notebook.id, &page, &objects, &section_dir)
        .map_err(|err| err.to_string())?;

    Ok(PageDto::from(page))
}

/// Deep-copies a template page's objects onto a new page: a fresh id per object (the frontend
/// mints every other object id on the wire — see `renote_storage::new_id`'s doc comment — but a
/// server-initiated template copy has no frontend round trip to do it in), and any `data.assetPath`
/// file physically copied into the new page's own asset folder so the copy owns its files
/// independently, the same "copy the file, remap the path" shape `copy_page_asset` (Phase 8.1)
/// gives one asset at a time, generalized over a whole object list.
///
/// `pointDataAssetPath` (ink-stroke blobs) is deliberately left unrewritten: the existing
/// cross-page paste path (`apps/desktop/src/page-editor/clipboard.ts`'s `assetPathsOf`) has the
/// same scope today, and a section-relative path stays resolvable from either page either way.
fn copy_template_objects(
    section_dir: &std::path::Path,
    new_page_id: &str,
    objects: Vec<renote_storage::PageObjectEnvelope>,
) -> Result<Vec<renote_storage::PageObjectEnvelope>, renote_storage::StorageError> {
    let mut copied = Vec::with_capacity(objects.len());
    for mut object in objects {
        object.id = renote_storage::new_id();
        if let Some(asset_path) = object.data.get("assetPath").and_then(|value| value.as_str()) {
            let bytes = renote_storage::read_asset(section_dir, asset_path)?;
            let file_name = std::path::Path::new(asset_path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("asset");
            let new_asset_path =
                renote_storage::write_asset(section_dir, new_page_id, file_name, &bytes)?;
            if let Some(map) = object.data.as_object_mut() {
                map.insert("assetPath".to_string(), serde_json::Value::String(new_asset_path));
            }
        }
        copied.push(object);
    }
    Ok(copied)
}

#[tauri::command]
pub fn load_page_objects<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: LoadPageObjectsRequestDto,
) -> Result<PageDocumentDto, String> {
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let doc =
        renote_storage::read_page(&section_dir, &request.page_id).map_err(|err| err.to_string())?;
    Ok(PageDocumentDto {
        page: doc.page.into(),
        objects: doc.objects.into_iter().map(Into::into).collect(),
    })
}

#[tauri::command]
pub fn save_page_objects<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: SavePageObjectsRequestDto,
) -> Result<PageDto, String> {
    let (notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;

    // Read current metadata first: write_page overwrites the whole document
    // but preserves fields (id/createdAt/...) by mutating this in place.
    let mut page = renote_storage::read_page(&section_dir, &request.page_id)
        .map_err(|err| err.to_string())?
        .page;

    // External-change guard. `write_page` stamps a fresh `modifiedAt` (RFC 3339,
    // nanosecond precision) on every write, so the document already carries a
    // unique-per-write token that survives any sync tool — no hashing, no mtime,
    // no server-side session map. A mismatch means something outside this
    // editor rewrote the page since it was loaded (Syncthing, Dropbox, a git
    // checkout, another window), so refuse rather than overwrite it. The
    // frontend surfaces the choice; nothing auto-merges.
    if let Some(expected) = &request.expected_modified_at {
        if expected != &page.modified_at {
            return Err(format!("conflict:{}", page.modified_at));
        }
    }

    let objects: Vec<renote_storage::PageObjectEnvelope> =
        request.objects.into_iter().map(Into::into).collect();

    renote_storage::write_page(&section_dir, &mut page, &objects).map_err(|err| err.to_string())?;

    let conn = renote_index::open_or_rebuild(std::path::Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::index_page(&conn, &notebook.id, &page, &objects, &section_dir)
        .map_err(|err| err.to_string())?;

    Ok(PageDto::from(page))
}

/// Updates only a page's background (paper color / rule-line style), leaving its objects
/// completely untouched. Deliberately a separate command from `save_page_objects` rather than
/// folding `background` into that frequent, debounced request — see this crate's Phase 5.10
/// plan note.
#[tauri::command]
pub fn update_page_background<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: UpdatePageBackgroundRequestDto,
) -> Result<PageDto, String> {
    let (notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;

    // Read the current document in full: write_page needs the existing objects handed back to
    // it unchanged (it overwrites the whole document), and re-indexing below needs them too.
    let doc =
        renote_storage::read_page(&section_dir, &request.page_id).map_err(|err| err.to_string())?;
    let mut page = doc.page;
    let objects = doc.objects;

    page.background = request.background.into();

    renote_storage::write_page(&section_dir, &mut page, &objects).map_err(|err| err.to_string())?;

    let conn = renote_index::open_or_rebuild(std::path::Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::index_page(&conn, &notebook.id, &page, &objects, &section_dir)
        .map_err(|err| err.to_string())?;

    Ok(PageDto::from(page))
}

/// Renames a page (updates its `title` only, leaving `objects` untouched) and re-indexes it —
/// same "read the full document, mutate one field, write_page, re-index" shape as
/// `update_page_background` just above, since title is searchable/browsable and must stay in
/// sync with the derived index the same way background does.
#[tauri::command]
pub fn rename_page<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: RenamePageRequestDto,
) -> Result<PageDto, String> {
    let (notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;

    naming::ensure_page_title_free(&section_dir, &request.title, Some(&request.page_id))?;

    let page = renote_storage::rename_page(&section_dir, &request.page_id, &request.title)
        .map_err(|err| err.to_string())?;

    let doc =
        renote_storage::read_page(&section_dir, &request.page_id).map_err(|err| err.to_string())?;
    let conn = renote_index::open_or_rebuild(std::path::Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::index_page(&conn, &notebook.id, &page, &doc.objects, &section_dir)
        .map_err(|err| err.to_string())?;

    Ok(PageDto::from(page))
}

/// Sets a page's `parentPageId` (Phase 11.4 indent/outdent) — `null` un-indents it to top-level.
/// Same "mutate one field, write_page, re-index" shape as `rename_page` just above; never touches
/// `sectionId`/assets, unlike `move_page`, since a subpage relationship never crosses sections.
#[tauri::command]
pub fn set_page_parent<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: SetPageParentRequestDto,
) -> Result<PageDto, String> {
    let (notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;

    let page =
        renote_storage::set_page_parent(&section_dir, &request.page_id, request.parent_page_id)
            .map_err(|err| err.to_string())?;

    let doc =
        renote_storage::read_page(&section_dir, &request.page_id).map_err(|err| err.to_string())?;
    let conn = renote_index::open_or_rebuild(std::path::Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::index_page(&conn, &notebook.id, &page, &doc.objects, &section_dir)
        .map_err(|err| err.to_string())?;

    Ok(PageDto::from(page))
}

/// Moves a page into another section (possibly in another notebook), then fixes both notebooks'
/// derived indexes: the page is removed from the source index and inserted into the destination's.
/// Within one notebook those are the same database, and `remove_page` + `index_page` on the same
/// connection is exactly the delete-then-reinsert `index_page` already does internally.
///
/// The title is de-duplicated against the destination the same way `create_page` de-duplicates a
/// new page's title — two pages named the same thing in one section is the one thing the naming
/// rules exist to prevent, and a move is just as capable of causing it as a create.
#[tauri::command]
pub fn move_page<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: MovePageRequestDto,
) -> Result<PageDto, String> {
    let (notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let (target_notebook, target_section_dir) = library::resolve_section_dir(
        &app,
        &request.target_notebook_id,
        &request.target_section_id,
    )?;

    if section_dir == target_section_dir {
        // Same section: this is a reorder, not a move — `reorder_pages` owns that.
        let page =
            renote_storage::set_page_order_key(&section_dir, &request.page_id, &request.order_key)
                .map_err(|err| err.to_string())?;
        let conn =
            renote_index::open_or_rebuild(std::path::Path::new(&notebook.path), &notebook.id)
                .map_err(|err| err.to_string())?;
        let doc = renote_storage::read_page(&section_dir, &request.page_id)
            .map_err(|err| err.to_string())?;
        renote_index::index_page(&conn, &notebook.id, &page, &doc.objects, &section_dir)
            .map_err(|err| err.to_string())?;
        return Ok(PageDto::from(page));
    }

    let current =
        renote_storage::read_page(&section_dir, &request.page_id).map_err(|err| err.to_string())?;
    let title = naming::free_page_title(&target_section_dir, &current.page.title)?;

    let mut page = renote_storage::move_page(
        &section_dir,
        &target_section_dir,
        &request.target_section_id,
        &request.page_id,
        &request.order_key,
    )
    .map_err(|err| err.to_string())?;

    if page.title != title {
        page = renote_storage::rename_page(&target_section_dir, &request.page_id, &title)
            .map_err(|err| err.to_string())?;
    }

    let source_conn =
        renote_index::open_or_rebuild(std::path::Path::new(&notebook.path), &notebook.id)
            .map_err(|err| err.to_string())?;
    renote_index::remove_page(&source_conn, &request.page_id).map_err(|err| err.to_string())?;

    let target_conn = renote_index::open_or_rebuild(
        std::path::Path::new(&target_notebook.path),
        &target_notebook.id,
    )
    .map_err(|err| err.to_string())?;
    renote_index::index_page(
        &target_conn,
        &target_notebook.id,
        &page,
        &current.objects,
        &target_section_dir,
    )
    .map_err(|err| err.to_string())?;

    Ok(PageDto::from(page))
}

/// Renumbers a section's pages into the given order. See `ReorderPagesRequestDto` for why every
/// page is rewritten rather than one key being inserted between two others.
#[tauri::command]
pub fn reorder_pages<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ReorderPagesRequestDto,
) -> Result<Vec<PageDto>, String> {
    let (notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let conn = renote_index::open_or_rebuild(std::path::Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;

    let mut pages = Vec::with_capacity(request.page_ids.len());
    for (position, page_id) in request.page_ids.iter().enumerate() {
        // Small integers, zero-padded to the same fixed width the frontend's timestamp-based keys
        // use — so a reordered page still sorts before every page created later, which is what
        // "new items append at the end" means.
        let order_key = format!("{position:020}");
        let page = renote_storage::set_page_order_key(&section_dir, page_id, &order_key)
            .map_err(|err| err.to_string())?;
        let doc =
            renote_storage::read_page(&section_dir, page_id).map_err(|err| err.to_string())?;
        renote_index::index_page(&conn, &notebook.id, &page, &doc.objects, &section_dir)
            .map_err(|err| err.to_string())?;
        pages.push(PageDto::from(page));
    }
    Ok(pages)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object(id: &str, asset_path: Option<&str>) -> renote_storage::PageObjectEnvelope {
        let mut data = serde_json::json!({});
        if let Some(path) = asset_path {
            data = serde_json::json!({ "assetPath": path });
        }
        renote_storage::PageObjectEnvelope {
            id: id.to_string(),
            r#type: "text-box".to_string(),
            transform: renote_storage::Transform2D {
                x: 0.0,
                y: 0.0,
                rotation: 0.0,
                scale_x: 1.0,
                scale_y: 1.0,
                z_index: 0.0,
            },
            bounds: renote_storage::Bounds { x: 0.0, y: 0.0, width: 10.0, height: 10.0 },
            data,
        }
    }

    #[test]
    fn copy_template_objects_mints_fresh_ids_and_leaves_asset_free_objects_alone() {
        let dir = tempfile::tempdir().expect("tempdir");
        let objects = vec![object("orig-1", None), object("orig-2", None)];

        let copied = copy_template_objects(dir.path(), "new-page", objects).expect("copy");

        assert_eq!(copied.len(), 2);
        for object in &copied {
            assert_ne!(object.id, "orig-1");
            assert_ne!(object.id, "orig-2");
        }
        assert_ne!(copied[0].id, copied[1].id);
    }

    #[test]
    fn copy_template_objects_copies_the_asset_file_and_remaps_the_path_under_the_new_page() {
        let dir = tempfile::tempdir().expect("tempdir");
        let original_path =
            renote_storage::write_asset(dir.path(), "template-page", "photo.png", b"bytes")
                .expect("seed asset");
        let objects = vec![object("orig-1", Some(&original_path))];

        let copied = copy_template_objects(dir.path(), "new-page", objects).expect("copy");

        let new_path = copied[0].data.get("assetPath").and_then(|v| v.as_str()).expect("assetPath");
        assert_ne!(new_path, original_path);
        assert!(new_path.contains("new-page"));
        assert_eq!(renote_storage::read_asset(dir.path(), new_path).unwrap(), b"bytes");
        // The original file is untouched — the copy owns an independent file.
        assert_eq!(renote_storage::read_asset(dir.path(), &original_path).unwrap(), b"bytes");
    }
}
