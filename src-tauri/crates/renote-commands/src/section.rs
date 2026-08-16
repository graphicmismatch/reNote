//! Section and section-group commands: thin wrappers delegating to
//! `renote_storage`, keeping the owning notebook's derived index in sync
//! as a side effect (same pattern as `crate::notebook`/`crate::page`).

use std::path::Path;

use tauri::Runtime;

use crate::dto::{
    CreateSectionGroupRequestDto, CreateSectionRequestDto, ListSectionsRequestDto,
    MoveSectionRequestDto, RenameSectionGroupRequestDto, RenameSectionRequestDto, SectionDto,
    SectionGroupDto,
};
use crate::{library, naming};

#[tauri::command]
pub fn list_sections<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ListSectionsRequestDto,
) -> Result<Vec<SectionDto>, String> {
    let (_notebook, parent_dir) = library::resolve_parent_dir(
        &app,
        &request.notebook_id,
        request.parent_group_id.as_deref(),
    )?;
    let sections = renote_storage::list_sections(&parent_dir).map_err(|err| err.to_string())?;
    Ok(sections.into_iter().map(SectionDto::from).collect())
}

#[tauri::command]
pub fn list_section_groups<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ListSectionsRequestDto,
) -> Result<Vec<SectionGroupDto>, String> {
    let (_notebook, parent_dir) = library::resolve_parent_dir(
        &app,
        &request.notebook_id,
        request.parent_group_id.as_deref(),
    )?;
    let groups = renote_storage::list_section_groups(&parent_dir).map_err(|err| err.to_string())?;
    Ok(groups.into_iter().map(SectionGroupDto::from).collect())
}

#[tauri::command]
pub fn create_section<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: CreateSectionRequestDto,
) -> Result<SectionDto, String> {
    let (notebook, parent_dir) = library::resolve_parent_dir(
        &app,
        &request.notebook_id,
        request.parent_group_id.as_deref(),
    )?;

    // Suffixed rather than rejected when taken — see `naming`'s module docs.
    let name = naming::free_section_name(Path::new(&notebook.path), &notebook.id, &request.name)?;

    let section = renote_storage::create_section(
        &parent_dir,
        &request.notebook_id,
        request.parent_group_id.clone(),
        &name,
        request.color,
        &request.order_key,
    )
    .map_err(|err| err.to_string())?;

    let section_dir = renote_storage::section_dir(&parent_dir, &section.id);
    let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::index_section(&conn, &section, &section_dir).map_err(|err| err.to_string())?;

    Ok(SectionDto::from(section))
}

#[tauri::command]
pub fn rename_section<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: RenameSectionRequestDto,
) -> Result<SectionDto, String> {
    let (notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;

    naming::ensure_section_name_free(
        Path::new(&notebook.path),
        &notebook.id,
        &request.name,
        Some(&request.section_id),
    )?;

    let section = renote_storage::rename_section(&section_dir, &request.name)
        .map_err(|err| err.to_string())?;

    let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::index_section(&conn, &section, &section_dir).map_err(|err| err.to_string())?;

    Ok(SectionDto::from(section))
}

#[tauri::command]
pub fn rename_section_group<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: RenameSectionGroupRequestDto,
) -> Result<SectionGroupDto, String> {
    let (notebook, group_dir) =
        library::resolve_parent_dir(&app, &request.notebook_id, Some(&request.group_id))?;

    let group = renote_storage::rename_section_group(&group_dir, &request.name)
        .map_err(|err| err.to_string())?;

    let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::index_section_group(&conn, &group, &group_dir).map_err(|err| err.to_string())?;

    Ok(SectionGroupDto::from(group))
}

#[tauri::command]
pub fn create_section_group<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: CreateSectionGroupRequestDto,
) -> Result<SectionGroupDto, String> {
    let (notebook, parent_dir) = library::resolve_parent_dir(
        &app,
        &request.notebook_id,
        request.parent_group_id.as_deref(),
    )?;

    let group = renote_storage::create_section_group(
        &parent_dir,
        &request.notebook_id,
        request.parent_group_id.clone(),
        &request.name,
        &request.order_key,
    )
    .map_err(|err| err.to_string())?;

    let group_dir = renote_storage::section_group_dir(&parent_dir, &group.id);
    let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::index_section_group(&conn, &group, &group_dir).map_err(|err| err.to_string())?;

    Ok(SectionGroupDto::from(group))
}

/// Moves a section under a different parent (the notebook root, or a section-group) within the
/// same notebook, then rebuilds that notebook's index.
///
/// A full rebuild rather than a targeted update because a section's folder path is stored on the
/// section row AND on every page row beneath it (`section_dir`), and a moved section can contain
/// any number of pages — walking them by hand here would be a second, subtly different copy of
/// what `rebuild_from_scan` already does correctly.
///
/// ponytail: full rebuild on every section move — O(notebook), but a section move is a rare,
/// deliberate act. Update the section's own rows and its pages' `section_dir` in place if this
/// ever feels slow on a large notebook.
#[tauri::command]
pub fn move_section<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: MoveSectionRequestDto,
) -> Result<SectionDto, String> {
    let (notebook, from_parent_dir) =
        library::resolve_current_parent_dir(&app, &request.notebook_id, &request.id)?;
    let (_notebook, to_parent_dir) = library::resolve_parent_dir(
        &app,
        &request.notebook_id,
        request.target_parent_group_id.as_deref(),
    )?;

    // No name check: section names are unique across the whole notebook (see `naming`), not per
    // parent folder, and a move changes neither the name nor the notebook.
    let moved = renote_storage::move_section(&from_parent_dir, &to_parent_dir, &request.id)
        .map_err(|err| err.to_string())?;

    let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::rebuild_from_scan(&conn, Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;

    Ok(SectionDto::from(moved))
}

/// Moves a section-group — and everything nested inside it — under a different parent. Same
/// rebuild reasoning as `move_section`.
#[tauri::command]
pub fn move_section_group<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: MoveSectionRequestDto,
) -> Result<SectionGroupDto, String> {
    let (notebook, from_parent_dir) =
        library::resolve_current_parent_dir(&app, &request.notebook_id, &request.id)?;
    let (_notebook, to_parent_dir) = library::resolve_parent_dir(
        &app,
        &request.notebook_id,
        request.target_parent_group_id.as_deref(),
    )?;

    if to_parent_dir.starts_with(renote_storage::section_group_dir(&from_parent_dir, &request.id)) {
        return Err("A section group can't be moved inside itself.".to_string());
    }

    let moved = renote_storage::move_section_group(&from_parent_dir, &to_parent_dir, &request.id)
        .map_err(|err| err.to_string())?;

    let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::rebuild_from_scan(&conn, Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;

    Ok(SectionGroupDto::from(moved))
}
