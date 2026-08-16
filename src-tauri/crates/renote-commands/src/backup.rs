//! Notebook backup/restore commands: thin wrappers delegating to
//! `renote_storage::{create_notebook_archive, restore_notebook_archive}`,
//! initializing the restored notebook's derived index afterward (same
//! pattern as `crate::notebook::create_notebook`).
//!
//! Neither command picks a filesystem path on the user's behalf — the
//! frontend resolves `destPath`/`archivePath` via a native save/open
//! dialog (`@tauri-apps/plugin-dialog`) before calling either of these.

use std::path::Path;

use tauri::Runtime;

use crate::dto::{ExportNotebookBackupRequestDto, ImportNotebookBackupRequestDto, NotebookDto};
use crate::library;

#[tauri::command]
pub fn export_notebook_backup<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ExportNotebookBackupRequestDto,
) -> Result<(), String> {
    let notebook = library::find_notebook(&app, &request.notebook_id)?;
    let notebook_dir = Path::new(&notebook.path).to_path_buf();
    renote_storage::create_notebook_archive(&notebook_dir, Path::new(&request.dest_path))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn import_notebook_backup<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ImportNotebookBackupRequestDto,
) -> Result<NotebookDto, String> {
    let library_root = library::default_library_root(&app)?;
    let notebook =
        renote_storage::restore_notebook_archive(&library_root, Path::new(&request.archive_path))
            .map_err(|err| err.to_string())?;

    // The restored folder has no `.renote-index/` (backups never include
    // it — see `renote_storage::backup`'s doc comment), so this always
    // performs a full rebuild-from-scan, indexing the notebook's real
    // restored content rather than starting from an empty index.
    renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;

    Ok(NotebookDto::from(notebook))
}
