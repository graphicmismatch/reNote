//! Resolves *where on disk* the notebook library lives, and the small
//! id -> filesystem-location lookups the command layer needs to turn a
//! `notebookId`/`sectionId` from the frontend into a `renote_storage`/
//! `renote_index` call.
//!
//! ## Library root (Phase 5.5: workspace-backed)
//! Every notebook the app knows about lives directly under a single
//! library root, but that root is no longer hardcoded: it's the currently
//! open *workspace* folder the user chose (see `crate::workspace` and the
//! `Mutex<renote_storage::WorkspaceConfig>` app state managed in the root
//! `renote_lib::run()` setup hook). Only one workspace is open per app
//! instance. If no workspace has been chosen yet (fresh install, and no
//! legacy library was found to migrate), `default_library_root` fails —
//! callers surface that as "pick a workspace" in the UI rather than
//! silently falling back to some default folder. `create_notebook` still
//! accepts an explicit `parentDirectory` override per request if the
//! frontend ever needs one (e.g. "create notebook elsewhere"), it just
//! isn't the default.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{Manager, Runtime};

use renote_storage::{Notebook, WorkspaceConfig};

/// The app's current notebook library root: the open workspace folder,
/// created if it doesn't exist yet. Fails if no workspace has been chosen
/// (see module docs).
pub fn default_library_root<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let state = app.state::<Mutex<WorkspaceConfig>>();
    let config = state.lock().map_err(|_| "workspace config lock poisoned".to_string())?;
    let Some(workspace_path) = config.workspace_path.as_ref() else {
        return Err("no workspace selected".to_string());
    };
    let root = PathBuf::from(workspace_path);
    std::fs::create_dir_all(&root)
        .map_err(|err| format!("failed to create library root {}: {err}", root.display()))?;
    Ok(root)
}

/// Finds a notebook by id under the default library root. Notebook folders
/// are named after their (sanitized) `name`, not their `id` (see
/// `renote_storage::notebook`'s module docs), so resolving an id to a
/// folder means scanning `list_notebooks` and matching — fine at Phase 1
/// notebook counts; a later phase can add a small id->path cache if this
/// ever shows up as a bottleneck.
pub fn find_notebook<R: Runtime>(
    app: &tauri::AppHandle<R>,
    notebook_id: &str,
) -> Result<Notebook, String> {
    let root = default_library_root(app)?;
    let notebooks = renote_storage::list_notebooks(&root).map_err(|err| err.to_string())?;
    notebooks
        .into_iter()
        .find(|n| n.id == notebook_id)
        .ok_or_else(|| format!("notebook not found: {notebook_id}"))
}

/// Resolves a section id to its absolute on-disk folder, via the owning
/// notebook's index (opening/rebuilding it first if needed — see
/// `renote_index::open_or_rebuild`). Returns the notebook too, since
/// callers generally need both.
pub fn resolve_section_dir<R: Runtime>(
    app: &tauri::AppHandle<R>,
    notebook_id: &str,
    section_id: &str,
) -> Result<(Notebook, PathBuf), String> {
    let notebook = find_notebook(app, notebook_id)?;
    let notebook_dir = Path::new(&notebook.path).to_path_buf();
    let conn = renote_index::open_or_rebuild(&notebook_dir, &notebook.id)
        .map_err(|err| err.to_string())?;
    let dir_path = renote_index::section_dir_path(&conn, section_id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("section not found: {section_id}"))?;
    Ok((notebook, PathBuf::from(dir_path)))
}

/// Resolves the folder that a section/section-group should be listed from
/// or created under: the notebook root when `parent_group_id` is `None`,
/// or a section-group's own folder (via the index) otherwise. Returns the
/// notebook too, since callers generally need both.
pub fn resolve_parent_dir<R: Runtime>(
    app: &tauri::AppHandle<R>,
    notebook_id: &str,
    parent_group_id: Option<&str>,
) -> Result<(Notebook, PathBuf), String> {
    let notebook = find_notebook(app, notebook_id)?;
    let notebook_dir = Path::new(&notebook.path).to_path_buf();

    let Some(group_id) = parent_group_id else {
        return Ok((notebook, notebook_dir));
    };

    let conn = renote_index::open_or_rebuild(&notebook_dir, &notebook.id)
        .map_err(|err| err.to_string())?;
    let dir_path = renote_index::group_dir_path(&conn, group_id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("section group not found: {group_id}"))?;
    Ok((notebook, PathBuf::from(dir_path)))
}

/// Resolves the folder a section or section-group currently sits IN — i.e. the parent of its own
/// folder, which is either the notebook root or a section-group's folder. Needed by the move
/// commands, which have to name the source parent without the frontend telling them what it is
/// (the tree knows where a row is displayed, not where it lives on disk).
pub fn resolve_current_parent_dir<R: Runtime>(
    app: &tauri::AppHandle<R>,
    notebook_id: &str,
    id: &str,
) -> Result<(Notebook, PathBuf), String> {
    let notebook = find_notebook(app, notebook_id)?;
    let notebook_dir = Path::new(&notebook.path).to_path_buf();
    let conn = renote_index::open_or_rebuild(&notebook_dir, &notebook.id)
        .map_err(|err| err.to_string())?;

    let dir_path = renote_index::section_dir_path(&conn, id)
        .map_err(|err| err.to_string())?
        .or(renote_index::group_dir_path(&conn, id).map_err(|err| err.to_string())?)
        .ok_or_else(|| format!("section or section group not found: {id}"))?;

    let parent = Path::new(&dir_path)
        .parent()
        .ok_or_else(|| format!("no parent folder for: {dir_path}"))?
        .to_path_buf();
    Ok((notebook, parent))
}
