//! Notebook create/list/read/delete.
//!
//! A notebook is a directory whose name is derived from the notebook's
//! (sanitized, deduped) `name` — the only folder in this crate named after
//! user-supplied text rather than an ID, since `Notebook.path` is stored
//! explicitly in its metadata and notebooks are the unit a user browses to
//! directly in a file manager. The folder is marked as a notebook root by a
//! `.renote-notebook.json` file at its top containing the `Notebook` struct
//! itself (a bare folder can't hold `id`/`color`/timestamps on its own).

use std::path::{Path, PathBuf};

use crate::error::StorageError;
use crate::model::Notebook;
use crate::{json_io, util};

pub const NOTEBOOK_MARKER_FILE: &str = ".renote-notebook.json";

/// Creates a new notebook folder under `parent_dir` (created if missing)
/// and writes its `.renote-notebook.json` marker. Returns the resulting
/// `Notebook`, whose `path` is the canonicalized absolute folder path.
pub fn create_notebook(
    parent_dir: &Path,
    name: &str,
    color: Option<String>,
) -> Result<Notebook, StorageError> {
    std::fs::create_dir_all(parent_dir)
        .map_err(|source| StorageError::Io { path: parent_dir.to_path_buf(), source })?;

    let dir_name = util::unique_dir_name(parent_dir, name);
    let notebook_dir = parent_dir.join(&dir_name);
    std::fs::create_dir(&notebook_dir)
        .map_err(|source| StorageError::Io { path: notebook_dir.clone(), source })?;

    let now = util::now_iso8601();
    let notebook = Notebook {
        id: util::new_id(),
        name: name.to_string(),
        path: util::canonical_path_string(&notebook_dir)?,
        color,
        created_at: now.clone(),
        modified_at: now,
    };
    json_io::write_json(&notebook_dir.join(NOTEBOOK_MARKER_FILE), &notebook)?;
    Ok(notebook)
}

/// Reads a single notebook's metadata given its root folder path.
pub fn read_notebook(notebook_dir: &Path) -> Result<Notebook, StorageError> {
    json_io::read_json(&notebook_dir.join(NOTEBOOK_MARKER_FILE))
}

/// Scans the immediate subdirectories of `root_dir` for notebook roots
/// (folders containing a `.renote-notebook.json` marker) and returns their
/// metadata, sorted by name. Returns an empty list if `root_dir` doesn't
/// exist yet, rather than erroring.
pub fn list_notebooks(root_dir: &Path) -> Result<Vec<Notebook>, StorageError> {
    let mut notebooks: Vec<Notebook> = Vec::new();

    let entries = match std::fs::read_dir(root_dir) {
        Ok(entries) => entries,
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => return Ok(notebooks),
        Err(source) => return Err(StorageError::Io { path: root_dir.to_path_buf(), source }),
    };

    for entry in entries {
        let entry =
            entry.map_err(|source| StorageError::Io { path: root_dir.to_path_buf(), source })?;
        let path: PathBuf = entry.path();
        if !path.is_dir() {
            continue;
        }
        let marker = path.join(NOTEBOOK_MARKER_FILE);
        if marker.is_file() {
            notebooks.push(json_io::read_json(&marker)?);
        }
    }

    notebooks.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(notebooks)
}

/// Renames a notebook in place: updates only the `name` field of its
/// `.renote-notebook.json` marker, returning the updated `Notebook`. The
/// on-disk folder name is deliberately left untouched — it was already
/// derived (and possibly dedup-suffixed) from the ORIGINAL name at create
/// time, and `Notebook.path` is the source of truth for where it lives, so
/// there is no correctness reason to rename the folder too, and doing so
/// would risk invalidating anything holding a reference to the old path
/// mid-operation.
pub fn rename_notebook(notebook_dir: &Path, name: &str) -> Result<Notebook, StorageError> {
    let mut notebook = read_notebook(notebook_dir)?;
    notebook.name = name.to_string();
    notebook.modified_at = util::now_iso8601();
    json_io::write_json(&notebook_dir.join(NOTEBOOK_MARKER_FILE), &notebook)?;
    Ok(notebook)
}

/// Deletes a notebook and everything under it (sections, pages, assets).
/// Plain filesystem removal — no recycle bin/soft-delete (out of scope for
/// Phase 1, see the project plan's Phase 5).
pub fn delete_notebook(notebook_dir: &Path) -> Result<(), StorageError> {
    std::fs::remove_dir_all(notebook_dir)
        .map_err(|source| StorageError::Io { path: notebook_dir.to_path_buf(), source })
}
