//! Soft-delete (recycle bin). Trashed notebooks/section-groups/sections/pages
//! are moved — not copied, not hard-deleted — into `<library-root>/.renote-trash/`,
//! a sibling of the notebook folders, deliberately *outside* the directory
//! tree `renote_index::rebuild_from_scan` walks (see `crate::notebook::list_notebooks`,
//! which only picks up folders carrying a `.renote-notebook.json` marker — a
//! trash entry folder never has one, so a rebuild can never resurrect a
//! trashed item into the search index). Each entry is a `<entry-id>/` folder
//! holding a `.renote-trash-entry.json` manifest (enough to restore: kind,
//! the item's own original id, and its original parent location) alongside
//! a `content/` folder holding the moved item in its original on-disk shape.
//!
//! This module only moves bytes on disk — it has no idea about the derived
//! SQLite index. The command layer (`renote-commands`) is responsible for
//! calling `renote_index::remove_page`/`remove_section`/etc. when trashing,
//! and re-indexing when restoring, exactly like it already does for every
//! other write in this crate.
//!
//! Restoring requires the original parent (section/notebook/parent group)
//! to still exist — resolving *where* to restore to is the caller's job
//! (same division of responsibility as the rest of this crate: storage
//! moves bytes at an already-resolved path, the command layer resolves
//! ids to paths via the index). Restoring into a since-deleted parent is
//! out of scope for this phase; the caller should surface a clear error.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::asset::page_assets_dir;
use crate::error::StorageError;
use crate::json_io;
use crate::model::{Notebook, Page, Section, SectionGroup};
use crate::page::page_json_path;
use crate::util;

pub const TRASH_DIR_NAME: &str = ".renote-trash";
const TRASH_MANIFEST_FILE: &str = ".renote-trash-entry.json";
const TRASH_CONTENT_DIR: &str = "content";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TrashItemKind {
    Notebook,
    SectionGroup,
    Section,
    Page,
}

/// A single trash entry's manifest. Which of `notebookId`/`parentGroupId`/`sectionId`
/// are populated depends on `kind` — see each field's doc comment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    /// This entry's own id (also its folder name under `.renote-trash/`).
    pub id: String,
    pub kind: TrashItemKind,
    /// The trashed item's own original id (its folder/file name before trashing,
    /// for section/section-group/page — notebooks are named after their
    /// sanitized `name` instead, see `originalDirName`).
    pub original_id: String,
    /// Display label for a trash-bin UI: the notebook/section/section-group
    /// name, or the page title.
    pub name: String,
    /// Owning notebook id. `None` only for `kind: Notebook` (a notebook has no parent).
    pub notebook_id: Option<String>,
    /// For `kind: Section`/`SectionGroup`: the original parent group id, or
    /// `None` if it sat directly under the notebook root. Unused otherwise.
    pub parent_group_id: Option<String>,
    /// For `kind: Page`: the original owning section id. Unused otherwise.
    pub section_id: Option<String>,
    /// For `kind: Notebook` only: its original folder name (sanitized from
    /// its `name`, not equal to its id — see `crate::notebook`'s doc comment).
    pub original_dir_name: Option<String>,
    pub deleted_at: String,
}

pub fn trash_root_dir(library_root: &Path) -> PathBuf {
    library_root.join(TRASH_DIR_NAME)
}

fn entry_dir(library_root: &Path, entry_id: &str) -> PathBuf {
    trash_root_dir(library_root).join(entry_id)
}

fn write_manifest(library_root: &Path, entry: &TrashEntry) -> Result<(), StorageError> {
    json_io::write_json(&entry_dir(library_root, &entry.id).join(TRASH_MANIFEST_FILE), entry)
}

/// Moves an already-resolved directory (a notebook/section/section-group's
/// own root) wholesale into a fresh trash entry's `content/` folder.
fn move_dir_into_trash(
    library_root: &Path,
    source_dir: &Path,
    entry: TrashEntry,
) -> Result<TrashEntry, StorageError> {
    let dest = entry_dir(library_root, &entry.id).join(TRASH_CONTENT_DIR);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|source| StorageError::Io { path: parent.to_path_buf(), source })?;
    }
    std::fs::rename(source_dir, &dest)
        .map_err(|source| StorageError::Io { path: source_dir.to_path_buf(), source })?;
    write_manifest(library_root, &entry)?;
    Ok(entry)
}

/// Trashes a notebook. `notebook_dir` is the notebook's own resolved directory
/// (`Path::new(&notebook.path)`).
pub fn trash_notebook(
    library_root: &Path,
    notebook_dir: &Path,
    notebook: &Notebook,
) -> Result<TrashEntry, StorageError> {
    let dir_name = notebook_dir
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| notebook.name.clone());
    let entry = TrashEntry {
        id: util::new_id(),
        kind: TrashItemKind::Notebook,
        original_id: notebook.id.clone(),
        name: notebook.name.clone(),
        notebook_id: None,
        parent_group_id: None,
        section_id: None,
        original_dir_name: Some(dir_name),
        deleted_at: util::now_iso8601(),
    };
    move_dir_into_trash(library_root, notebook_dir, entry)
}

/// Trashes a section-group. `group_dir` is the group's own resolved directory.
pub fn trash_section_group(
    library_root: &Path,
    group_dir: &Path,
    group: &SectionGroup,
) -> Result<TrashEntry, StorageError> {
    let entry = TrashEntry {
        id: util::new_id(),
        kind: TrashItemKind::SectionGroup,
        original_id: group.id.clone(),
        name: group.name.clone(),
        notebook_id: Some(group.notebook_id.clone()),
        parent_group_id: group.parent_id.clone(),
        section_id: None,
        original_dir_name: None,
        deleted_at: util::now_iso8601(),
    };
    move_dir_into_trash(library_root, group_dir, entry)
}

/// Trashes a section. `section_dir` is the section's own resolved directory.
pub fn trash_section(
    library_root: &Path,
    section_dir: &Path,
    section: &Section,
) -> Result<TrashEntry, StorageError> {
    let entry = TrashEntry {
        id: util::new_id(),
        kind: TrashItemKind::Section,
        original_id: section.id.clone(),
        name: section.name.clone(),
        notebook_id: Some(section.notebook_id.clone()),
        parent_group_id: section.parent_group_id.clone(),
        section_id: None,
        original_dir_name: None,
        deleted_at: util::now_iso8601(),
    };
    move_dir_into_trash(library_root, section_dir, entry)
}

/// Trashes a single page: moves its `<pageId>.page.json` and (if present)
/// `assets/<pageId>/` folder out of `section_dir` into a fresh trash entry's
/// `content/`, preserving the same relative shape so restore is a direct
/// move back — a page has no directory of its own to move wholesale.
pub fn trash_page(
    library_root: &Path,
    section_dir: &Path,
    notebook_id: &str,
    page: &Page,
) -> Result<TrashEntry, StorageError> {
    let entry = TrashEntry {
        id: util::new_id(),
        kind: TrashItemKind::Page,
        original_id: page.id.clone(),
        name: page.title.clone(),
        notebook_id: Some(notebook_id.to_string()),
        parent_group_id: None,
        section_id: Some(page.section_id.clone()),
        original_dir_name: None,
        deleted_at: util::now_iso8601(),
    };
    let content_dir = entry_dir(library_root, &entry.id).join(TRASH_CONTENT_DIR);
    std::fs::create_dir_all(&content_dir)
        .map_err(|source| StorageError::Io { path: content_dir.clone(), source })?;

    let source_json = page_json_path(section_dir, &page.id);
    let dest_json = content_dir.join(format!("{}.page.json", page.id));
    std::fs::rename(&source_json, &dest_json)
        .map_err(|source| StorageError::Io { path: source_json.clone(), source })?;

    let source_assets = page_assets_dir(section_dir, &page.id);
    if source_assets.is_dir() {
        let dest_assets = content_dir.join("assets").join(&page.id);
        if let Some(parent) = dest_assets.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|source| StorageError::Io { path: parent.to_path_buf(), source })?;
        }
        std::fs::rename(&source_assets, &dest_assets)
            .map_err(|source| StorageError::Io { path: source_assets.clone(), source })?;
    }

    write_manifest(library_root, &entry)?;
    Ok(entry)
}

/// Scans `.renote-trash/*/` for entries, newest-deleted-first. Returns an
/// empty list if the trash folder doesn't exist yet, rather than erroring.
pub fn list_trash(library_root: &Path) -> Result<Vec<TrashEntry>, StorageError> {
    let root = trash_root_dir(library_root);
    let mut entries: Vec<TrashEntry> = Vec::new();

    let dir_entries = match std::fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => return Ok(entries),
        Err(source) => return Err(StorageError::Io { path: root.clone(), source }),
    };

    for dir_entry in dir_entries {
        let dir_entry =
            dir_entry.map_err(|source| StorageError::Io { path: root.clone(), source })?;
        let path = dir_entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest = path.join(TRASH_MANIFEST_FILE);
        if manifest.is_file() {
            entries.push(json_io::read_json(&manifest)?);
        }
    }

    entries.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(entries)
}

/// Restores a trash entry to `target_dir` — the resolved destination the
/// caller has already computed (a page's owning section folder, a
/// section/section-group's parent folder, or the library root for a
/// notebook). Removes the trash entry on success.
pub fn restore_from_trash(
    library_root: &Path,
    entry_id: &str,
    target_dir: &Path,
) -> Result<TrashEntry, StorageError> {
    let dir = entry_dir(library_root, entry_id);
    let entry: TrashEntry = json_io::read_json(&dir.join(TRASH_MANIFEST_FILE))?;
    let content_dir = dir.join(TRASH_CONTENT_DIR);

    std::fs::create_dir_all(target_dir)
        .map_err(|source| StorageError::Io { path: target_dir.to_path_buf(), source })?;

    match entry.kind {
        TrashItemKind::Page => {
            let source_json = content_dir.join(format!("{}.page.json", entry.original_id));
            let dest_json = target_dir.join(format!("{}.page.json", entry.original_id));
            std::fs::rename(&source_json, &dest_json)
                .map_err(|source| StorageError::Io { path: source_json.clone(), source })?;

            let source_assets = content_dir.join("assets").join(&entry.original_id);
            if source_assets.is_dir() {
                let dest_assets = target_dir.join("assets").join(&entry.original_id);
                if let Some(parent) = dest_assets.parent() {
                    std::fs::create_dir_all(parent).map_err(|source| StorageError::Io {
                        path: parent.to_path_buf(),
                        source,
                    })?;
                }
                std::fs::rename(&source_assets, &dest_assets)
                    .map_err(|source| StorageError::Io { path: source_assets.clone(), source })?;
            }
        }
        TrashItemKind::Notebook => {
            let dir_name = entry.original_dir_name.as_deref().unwrap_or(&entry.original_id);
            let dest = target_dir.join(dir_name);
            std::fs::rename(&content_dir, &dest)
                .map_err(|source| StorageError::Io { path: content_dir.clone(), source })?;
        }
        TrashItemKind::Section | TrashItemKind::SectionGroup => {
            let dest = target_dir.join(&entry.original_id);
            std::fs::rename(&content_dir, &dest)
                .map_err(|source| StorageError::Io { path: content_dir.clone(), source })?;
        }
    }

    // Best-effort: the manifest/entry folder is now empty (content/ was moved out).
    let _ = std::fs::remove_dir_all(&dir);
    Ok(entry)
}

/// Permanently deletes one trash entry. Irreversible.
pub fn empty_trash_entry(library_root: &Path, entry_id: &str) -> Result<(), StorageError> {
    let dir = entry_dir(library_root, entry_id);
    std::fs::remove_dir_all(&dir).map_err(|source| StorageError::Io { path: dir, source })
}

/// Permanently deletes every trash entry. Irreversible.
pub fn empty_trash(library_root: &Path) -> Result<(), StorageError> {
    let root = trash_root_dir(library_root);
    match std::fs::remove_dir_all(&root) {
        Ok(()) => Ok(()),
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(StorageError::Io { path: root, source }),
    }
}
