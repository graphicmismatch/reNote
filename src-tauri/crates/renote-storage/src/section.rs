//! Section-group and section create/list/delete.
//!
//! Both are directories whose name is their own `id` (unlike notebooks —
//! see `crate::notebook` — a section/section-group has no `path` field in
//! the domain model, so its folder location is always derived as
//! `parent_dir.join(id)` rather than stored). Each is marked with a small
//! metadata file (`.renote-section-group.json` / `.renote-section.json`)
//! holding the struct itself, since a folder alone can't carry `id`/
//! `color`/`orderKey`. Section groups and sections may nest arbitrarily
//! under `parent_dir` (a section group's folder can itself contain more
//! section-group or section folders); pages live directly inside a
//! section's folder (see `crate::page`), never inside a section group's.

use std::path::{Path, PathBuf};

use crate::error::StorageError;
use crate::model::{Section, SectionGroup, SectionGroupId, SectionId};
use crate::{json_io, util};

pub const SECTION_GROUP_MARKER_FILE: &str = ".renote-section-group.json";
pub const SECTION_MARKER_FILE: &str = ".renote-section.json";

/// The folder a section group with the given id lives in, under `parent_dir`.
pub fn section_group_dir(parent_dir: &Path, group_id: &str) -> PathBuf {
    parent_dir.join(group_id)
}

/// The folder a section with the given id lives in, under `parent_dir`.
pub fn section_dir(parent_dir: &Path, section_id: &str) -> PathBuf {
    parent_dir.join(section_id)
}

/// Reads a single section-group's metadata given its own folder path.
pub fn read_section_group(group_dir: &Path) -> Result<SectionGroup, StorageError> {
    json_io::read_json(&group_dir.join(SECTION_GROUP_MARKER_FILE))
}

/// Reads a single section's metadata given its own folder path.
pub fn read_section(section_dir: &Path) -> Result<Section, StorageError> {
    json_io::read_json(&section_dir.join(SECTION_MARKER_FILE))
}

/// Creates a new section-group folder under `parent_dir` (a notebook root
/// or another section-group's folder) and writes its marker file.
pub fn create_section_group(
    parent_dir: &Path,
    notebook_id: &str,
    parent_id: Option<SectionGroupId>,
    name: &str,
    order_key: &str,
) -> Result<SectionGroup, StorageError> {
    let id = util::new_id();
    let dir = section_group_dir(parent_dir, &id);
    std::fs::create_dir_all(&dir)
        .map_err(|source| StorageError::Io { path: dir.clone(), source })?;

    let group = SectionGroup {
        id,
        notebook_id: notebook_id.to_string(),
        parent_id,
        name: name.to_string(),
        order_key: order_key.to_string(),
    };
    json_io::write_json(&dir.join(SECTION_GROUP_MARKER_FILE), &group)?;
    Ok(group)
}

/// Creates a new section folder under `parent_dir` (a notebook root or a
/// section-group's folder) and writes its marker file.
pub fn create_section(
    parent_dir: &Path,
    notebook_id: &str,
    parent_group_id: Option<SectionGroupId>,
    name: &str,
    color: Option<String>,
    order_key: &str,
) -> Result<Section, StorageError> {
    let id = util::new_id();
    let dir = section_dir(parent_dir, &id);
    std::fs::create_dir_all(&dir)
        .map_err(|source| StorageError::Io { path: dir.clone(), source })?;

    let section = Section {
        id,
        notebook_id: notebook_id.to_string(),
        parent_group_id,
        name: name.to_string(),
        color,
        order_key: order_key.to_string(),
    };
    json_io::write_json(&dir.join(SECTION_MARKER_FILE), &section)?;
    Ok(section)
}

/// Scans the immediate subdirectories of `parent_dir` for section-group
/// folders (marked with `.renote-section-group.json`).
pub fn list_section_groups(parent_dir: &Path) -> Result<Vec<SectionGroup>, StorageError> {
    list_marked(parent_dir, SECTION_GROUP_MARKER_FILE)
}

/// Scans the immediate subdirectories of `parent_dir` for section folders
/// (marked with `.renote-section.json`).
pub fn list_sections(parent_dir: &Path) -> Result<Vec<Section>, StorageError> {
    list_marked(parent_dir, SECTION_MARKER_FILE)
}

fn list_marked<T: serde::de::DeserializeOwned>(
    parent_dir: &Path,
    marker_file_name: &str,
) -> Result<Vec<T>, StorageError> {
    let mut items = Vec::new();

    let entries = match std::fs::read_dir(parent_dir) {
        Ok(entries) => entries,
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => return Ok(items),
        Err(source) => return Err(StorageError::Io { path: parent_dir.to_path_buf(), source }),
    };

    for entry in entries {
        let entry =
            entry.map_err(|source| StorageError::Io { path: parent_dir.to_path_buf(), source })?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let marker = path.join(marker_file_name);
        if marker.is_file() {
            items.push(json_io::read_json(&marker)?);
        }
    }

    Ok(items)
}

/// Renames a section in place: updates only the `name` field of its
/// `.renote-section.json` marker, returning the updated `Section`. Safe to
/// do without touching the folder itself — see the module doc comment: a
/// section's folder is named after its `id`, never its `name`.
pub fn rename_section(section_dir: &Path, name: &str) -> Result<Section, StorageError> {
    let mut section = read_section(section_dir)?;
    section.name = name.to_string();
    json_io::write_json(&section_dir.join(SECTION_MARKER_FILE), &section)?;
    Ok(section)
}

/// Renames a section-group in place: updates only the `name` field of its
/// `.renote-section-group.json` marker, returning the updated
/// `SectionGroup`. Same folder-naming reasoning as `rename_section`.
pub fn rename_section_group(group_dir: &Path, name: &str) -> Result<SectionGroup, StorageError> {
    let mut group = read_section_group(group_dir)?;
    group.name = name.to_string();
    json_io::write_json(&group_dir.join(SECTION_GROUP_MARKER_FILE), &group)?;
    Ok(group)
}

/// Moves a section's whole folder under a different parent (the notebook
/// root or another section-group), keeping its id, its name, its pages and
/// their assets. A section's folder is named after its id (see the module
/// doc comment), so this is a plain directory rename — no file inside it
/// has to change, and nothing that references a page by id notices.
pub fn move_section(
    from_parent_dir: &Path,
    to_parent_dir: &Path,
    section_id: &SectionId,
) -> Result<Section, StorageError> {
    let to_dir = move_child_dir(&section_dir(from_parent_dir, section_id), to_parent_dir)?;
    read_section(&to_dir)
}

/// Moves a section-group's folder — and therefore everything nested inside
/// it — under a different parent. Same rename-only reasoning as
/// [`move_section`].
pub fn move_section_group(
    from_parent_dir: &Path,
    to_parent_dir: &Path,
    group_id: &SectionGroupId,
) -> Result<SectionGroup, StorageError> {
    let to_dir = move_child_dir(&section_group_dir(from_parent_dir, group_id), to_parent_dir)?;
    read_section_group(&to_dir)
}

/// Renames `from_dir` into `to_parent_dir`, keeping its folder name (an id),
/// and returns its new path.
fn move_child_dir(from_dir: &Path, to_parent_dir: &Path) -> Result<PathBuf, StorageError> {
    let Some(name) = from_dir.file_name() else {
        return Err(StorageError::Io {
            path: from_dir.to_path_buf(),
            source: std::io::Error::new(std::io::ErrorKind::InvalidInput, "not a folder"),
        });
    };
    std::fs::create_dir_all(to_parent_dir)
        .map_err(|source| StorageError::Io { path: to_parent_dir.to_path_buf(), source })?;
    let to_dir = to_parent_dir.join(name);
    std::fs::rename(from_dir, &to_dir)
        .map_err(|source| StorageError::Io { path: from_dir.to_path_buf(), source })?;
    Ok(to_dir)
}

/// Deletes a section-group folder and everything nested under it.
pub fn delete_section_group(
    parent_dir: &Path,
    group_id: &SectionGroupId,
) -> Result<(), StorageError> {
    let dir = section_group_dir(parent_dir, group_id);
    std::fs::remove_dir_all(&dir).map_err(|source| StorageError::Io { path: dir, source })
}

/// Deletes a section folder — its pages and their assets — entirely.
pub fn delete_section(parent_dir: &Path, section_id: &SectionId) -> Result<(), StorageError> {
    let dir = section_dir(parent_dir, section_id);
    std::fs::remove_dir_all(&dir).map_err(|source| StorageError::Io { path: dir, source })
}
