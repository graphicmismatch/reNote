//! Notebook commands: thin wrappers delegating to `renote_storage`, keeping
//! each notebook's derived index initialized as a side effect.

use std::path::{Path, PathBuf};

use tauri::Runtime;

use crate::dto::{CreateNotebookRequestDto, NotebookDto, RenameNotebookRequestDto};
use crate::{library, naming};

#[tauri::command]
pub fn list_notebooks<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Vec<NotebookDto>, String> {
    let root = library::default_library_root(&app)?;
    let notebooks = renote_storage::list_notebooks(&root).map_err(|err| err.to_string())?;
    Ok(notebooks.into_iter().map(NotebookDto::from).collect())
}

#[tauri::command]
pub fn create_notebook<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: CreateNotebookRequestDto,
) -> Result<NotebookDto, String> {
    let parent_dir: PathBuf = match &request.parent_directory {
        Some(dir) => Path::new(dir).to_path_buf(),
        None => library::default_library_root(&app)?,
    };

    // Suffixed rather than rejected when taken — see `naming`'s module docs.
    let name = naming::free_notebook_name(&parent_dir, &request.name)?;

    let notebook = renote_storage::create_notebook(&parent_dir, &name, request.color)
        .map_err(|err| err.to_string())?;

    // Initialize the notebook's (empty) index eagerly so the first
    // list_pages/search call against it doesn't pay a first-open rebuild
    // cost, and so a fresh notebook always has a valid index file on disk.
    let notebook_dir = Path::new(&notebook.path).to_path_buf();
    renote_index::open_or_rebuild(&notebook_dir, &notebook.id).map_err(|err| err.to_string())?;

    Ok(NotebookDto::from(notebook))
}

#[tauri::command]
pub fn rename_notebook<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: RenameNotebookRequestDto,
) -> Result<NotebookDto, String> {
    let notebook = library::find_notebook(&app, &request.notebook_id)?;
    naming::ensure_notebook_name_free(
        &library::default_library_root(&app)?,
        &request.name,
        Some(&notebook.id),
    )?;
    let notebook_dir = Path::new(&notebook.path).to_path_buf();
    let renamed = renote_storage::rename_notebook(&notebook_dir, &request.name)
        .map_err(|err| err.to_string())?;
    Ok(NotebookDto::from(renamed))
}
