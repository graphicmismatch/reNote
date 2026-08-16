//! Autosave commands: thin wrappers delegating to `renote_storage::autosave`.
//! See that module's doc comment for the on-disk design.
//!
//! Unlike this module's predecessor (`version.rs`), nothing here is called
//! automatically from `crate::page::save_page_objects`. The frontend calls
//! [`save_autosave`] itself, on a timer, at the interval the user picked in
//! Settings — so a page's single autosave slot only ever reflects "the
//! content as of the last autosave tick", not "every save".

use tauri::Runtime;

use crate::dto::PageDto;
use crate::dto::{
    AutosaveMetaDto, GetAutosaveStatusRequestDto, RestoreAutosaveRequestDto, SaveAutosaveRequestDto,
};
use crate::library;

#[tauri::command]
pub fn get_autosave_status<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: GetAutosaveStatusRequestDto,
) -> Result<Option<AutosaveMetaDto>, String> {
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let status = renote_storage::autosave_status(&section_dir, &request.page_id)
        .map_err(|err| err.to_string())?;
    Ok(status.map(AutosaveMetaDto::from))
}

/// Restores the autosave by routing it through the exact same
/// read-then-`write_page`-then-reindex path a normal save uses (see
/// `crate::page::save_page_objects`) — "restore" is simply "load the
/// autosave, save it as current".
#[tauri::command]
pub fn restore_autosave<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: RestoreAutosaveRequestDto,
) -> Result<PageDto, String> {
    let (notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;

    // read_autosave already restores its own copies of every referenced
    // asset onto the live section_dir location (see
    // `renote_storage::autosave` doc comment), so the returned objects are
    // immediately safe to hand to write_page.
    let restored = renote_storage::read_autosave(&section_dir, &request.page_id)
        .map_err(|err| err.to_string())?;

    // Read current metadata first: write_page overwrites the whole document
    // but preserves fields (id/createdAt/...) by mutating this in place —
    // same pattern save_page_objects uses.
    let mut page = renote_storage::read_page(&section_dir, &request.page_id)
        .map_err(|err| err.to_string())?
        .page;

    renote_storage::write_page(&section_dir, &mut page, &restored.objects)
        .map_err(|err| err.to_string())?;

    let conn = renote_index::open_or_rebuild(std::path::Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::index_page(&conn, &notebook.id, &page, &restored.objects, &section_dir)
        .map_err(|err| err.to_string())?;

    Ok(PageDto::from(page))
}

/// Overwrites the page's ONE autosave slot with its current live state.
/// Called by the frontend on a timer, not tied to `save_page_objects`.
#[tauri::command]
pub fn save_autosave<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: SaveAutosaveRequestDto,
) -> Result<(), String> {
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let doc =
        renote_storage::read_page(&section_dir, &request.page_id).map_err(|err| err.to_string())?;
    renote_storage::write_autosave(&section_dir, &request.page_id, &doc)
        .map_err(|err| err.to_string())
}
