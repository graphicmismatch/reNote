//! Recycle-bin commands: trash/list/restore/empty. Thin wrappers delegating
//! to `renote_storage::trash`, keeping the owning notebook's derived index
//! in sync as a side effect (same pattern as every other write in this
//! crate — see `crate::notebook`/`crate::page`/`crate::section`).
//!
//! Trash is library-wide, not per-notebook (`.renote-trash/` lives at the
//! library root — see `renote_storage::trash`'s module doc comment for why),
//! so `list_trash`/`empty_trash` take no notebook id.

use std::path::Path;

use tauri::Runtime;

use crate::dto::{
    EmptyTrashEntryRequestDto, RestoreFromTrashRequestDto, TrashEntryDto, TrashNotebookRequestDto,
    TrashPageRequestDto, TrashSectionGroupRequestDto, TrashSectionRequestDto,
};
use crate::library;

#[tauri::command]
pub fn trash_notebook<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: TrashNotebookRequestDto,
) -> Result<TrashEntryDto, String> {
    let library_root = library::default_library_root(&app)?;
    let notebook = library::find_notebook(&app, &request.notebook_id)?;
    let notebook_dir = Path::new(&notebook.path).to_path_buf();
    // The notebook's own `.renote-index/` sqlite file moves with it (it's
    // inside the notebook directory being moved wholesale) — no separate
    // index cleanup needed at this layer for a notebook-level trash.
    let entry = renote_storage::trash_notebook(&library_root, &notebook_dir, &notebook)
        .map_err(|err| err.to_string())?;
    Ok(TrashEntryDto::from(entry))
}

#[tauri::command]
pub fn trash_section_group<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: TrashSectionGroupRequestDto,
) -> Result<TrashEntryDto, String> {
    let library_root = library::default_library_root(&app)?;
    let (notebook, group_dir) =
        library::resolve_parent_dir(&app, &request.notebook_id, Some(request.group_id.as_str()))?;
    let group = renote_storage::read_section_group(&group_dir).map_err(|err| err.to_string())?;
    let entry = renote_storage::trash_section_group(&library_root, &group_dir, &group)
        .map_err(|err| err.to_string())?;

    let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::remove_section_group(&conn, &request.group_id).map_err(|err| err.to_string())?;

    Ok(TrashEntryDto::from(entry))
}

#[tauri::command]
pub fn trash_section<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: TrashSectionRequestDto,
) -> Result<TrashEntryDto, String> {
    let library_root = library::default_library_root(&app)?;
    let (notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let section = renote_storage::read_section(&section_dir).map_err(|err| err.to_string())?;
    let entry = renote_storage::trash_section(&library_root, &section_dir, &section)
        .map_err(|err| err.to_string())?;

    let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    // Cascades to every page row that belonged to this section too.
    renote_index::remove_section(&conn, &request.section_id).map_err(|err| err.to_string())?;

    Ok(TrashEntryDto::from(entry))
}

#[tauri::command]
pub fn trash_page<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: TrashPageRequestDto,
) -> Result<TrashEntryDto, String> {
    let library_root = library::default_library_root(&app)?;
    let (notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let doc =
        renote_storage::read_page(&section_dir, &request.page_id).map_err(|err| err.to_string())?;
    let entry = renote_storage::trash_page(&library_root, &section_dir, &notebook.id, &doc.page)
        .map_err(|err| err.to_string())?;

    let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::remove_page(&conn, &request.page_id).map_err(|err| err.to_string())?;

    Ok(TrashEntryDto::from(entry))
}

#[tauri::command]
pub fn list_trash<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Vec<TrashEntryDto>, String> {
    let library_root = library::default_library_root(&app)?;
    let entries = renote_storage::list_trash(&library_root).map_err(|err| err.to_string())?;
    Ok(entries.into_iter().map(TrashEntryDto::from).collect())
}

#[tauri::command]
pub fn restore_from_trash<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: RestoreFromTrashRequestDto,
) -> Result<TrashEntryDto, String> {
    let library_root = library::default_library_root(&app)?;

    let entries = renote_storage::list_trash(&library_root).map_err(|err| err.to_string())?;
    let entry = entries
        .into_iter()
        .find(|entry| entry.id == request.entry_id)
        .ok_or_else(|| format!("trash entry not found: {}", request.entry_id))?;

    let target_dir = match entry.kind {
        renote_storage::TrashItemKind::Notebook => library_root.clone(),
        renote_storage::TrashItemKind::SectionGroup | renote_storage::TrashItemKind::Section => {
            let notebook_id = entry
                .notebook_id
                .as_deref()
                .ok_or_else(|| "trash entry is missing notebookId".to_string())?;
            library::resolve_parent_dir(&app, notebook_id, entry.parent_group_id.as_deref())?.1
        }
        renote_storage::TrashItemKind::Page => {
            let notebook_id = entry
                .notebook_id
                .as_deref()
                .ok_or_else(|| "trash entry is missing notebookId".to_string())?;
            let section_id = entry
                .section_id
                .as_deref()
                .ok_or_else(|| "trash entry is missing sectionId".to_string())?;
            library::resolve_section_dir(&app, notebook_id, section_id)?.1
        }
    };

    let restored =
        renote_storage::restore_from_trash(&library_root, &request.entry_id, &target_dir)
            .map_err(|err| err.to_string())?;

    reindex_restored(&app, &restored, &target_dir)?;

    Ok(TrashEntryDto::from(restored))
}

/// Re-syncs the derived index after a restore. A restored section-group can
/// contain arbitrarily nested content, so rather than hand-writing a
/// recursive re-indexer for that one case, a full `rebuild_from_scan` is the
/// simplest correct option — reasonable at the notebook sizes this phase
/// targets, and it's exactly what that function exists for.
fn reindex_restored<R: Runtime>(
    app: &tauri::AppHandle<R>,
    restored: &renote_storage::TrashEntry,
    target_dir: &Path,
) -> Result<(), String> {
    match restored.kind {
        renote_storage::TrashItemKind::Notebook => {
            let notebook = library::find_notebook(app, &restored.original_id)?;
            renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
                .map_err(|err| err.to_string())?;
        }
        renote_storage::TrashItemKind::SectionGroup => {
            let notebook_id = restored
                .notebook_id
                .as_deref()
                .ok_or_else(|| "trash entry is missing notebookId".to_string())?;
            let notebook = library::find_notebook(app, notebook_id)?;
            let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
                .map_err(|err| err.to_string())?;
            renote_index::rebuild_from_scan(&conn, Path::new(&notebook.path), &notebook.id)
                .map_err(|err| err.to_string())?;
        }
        renote_storage::TrashItemKind::Section => {
            let notebook_id = restored
                .notebook_id
                .as_deref()
                .ok_or_else(|| "trash entry is missing notebookId".to_string())?;
            let notebook = library::find_notebook(app, notebook_id)?;
            let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
                .map_err(|err| err.to_string())?;
            let section_dir = target_dir.join(&restored.original_id);
            let section =
                renote_storage::read_section(&section_dir).map_err(|err| err.to_string())?;
            renote_index::index_section(&conn, &section, &section_dir)
                .map_err(|err| err.to_string())?;
            for page_meta in
                renote_storage::list_pages(&section_dir).map_err(|err| err.to_string())?
            {
                let doc = renote_storage::read_page(&section_dir, &page_meta.id)
                    .map_err(|err| err.to_string())?;
                renote_index::index_page(
                    &conn,
                    &notebook.id,
                    &doc.page,
                    &doc.objects,
                    &section_dir,
                )
                .map_err(|err| err.to_string())?;
            }
        }
        renote_storage::TrashItemKind::Page => {
            let notebook_id = restored
                .notebook_id
                .as_deref()
                .ok_or_else(|| "trash entry is missing notebookId".to_string())?;
            let notebook = library::find_notebook(app, notebook_id)?;
            let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
                .map_err(|err| err.to_string())?;
            let doc = renote_storage::read_page(target_dir, &restored.original_id)
                .map_err(|err| err.to_string())?;
            renote_index::index_page(&conn, &notebook.id, &doc.page, &doc.objects, target_dir)
                .map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn empty_trash_entry<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: EmptyTrashEntryRequestDto,
) -> Result<(), String> {
    let library_root = library::default_library_root(&app)?;
    renote_storage::empty_trash_entry(&library_root, &request.entry_id)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn empty_trash<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let library_root = library::default_library_root(&app)?;
    renote_storage::empty_trash(&library_root).map_err(|err| err.to_string())
}
