//! Workspace commands: let the frontend read/change which folder the
//! currently open workspace lives in, and list recently used workspaces.
//!
//! The actual persisted state (`Mutex<renote_storage::WorkspaceConfig>`) is
//! set up once, at startup, by the root `renote_lib::run()` setup hook —
//! these commands only read/update that managed state and persist changes
//! back to `<app-config-dir>/renote/workspace.json` via
//! `renote_storage::save_workspace_config`.

use std::sync::Mutex;

use tauri::{Manager, Runtime};

use renote_storage::WorkspaceConfig;

use crate::dto::SetWorkspacePathRequestDto;

/// Computes `<app-config-dir>/renote`, the folder `workspace.json` lives
/// in. Mirrors the same computation the root setup hook performs once at
/// startup (see that file's doc comment for why config dir, not data dir).
fn workspace_config_dir<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<std::path::PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    Ok(config_dir.join("renote"))
}

#[tauri::command]
pub fn get_workspace_path<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Option<String>, String> {
    let state = app.state::<Mutex<WorkspaceConfig>>();
    let config = state.lock().map_err(|_| "workspace config lock poisoned".to_string())?;
    Ok(config.workspace_path.clone())
}

#[tauri::command]
pub fn set_workspace_path<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: SetWorkspacePathRequestDto,
) -> Result<(), String> {
    let path = std::path::Path::new(&request.path);
    std::fs::create_dir_all(path)
        .map_err(|err| format!("failed to create workspace folder {}: {err}", path.display()))?;

    // Canonicalize BEFORE storing/scoping, not after: `resolve_asset_path` (crate::asset)
    // always canonicalizes the paths it resolves (asset files live under this workspace root),
    // and Tauri's asset-protocol scope check compares the requested path against exactly what
    // was granted here. If the raw, as-picked path differs from its own canonical form — e.g.
    // the workspace folder (or an ancestor of it, like the user's home directory) is a symlink,
    // which is common for synced/cloud-storage folders — a scope granted for the RAW path would
    // never match a CANONICALIZED asset path, silently denying every asset-protocol request
    // forever (not just once, and not fixed by remounting/restarting anything, since the
    // mismatch is a fixed property of the stored path, not a timing issue). Canonicalizing once,
    // here, at the single point this crate ever persists/scopes a workspace path, keeps every
    // downstream consumer (`default_library_root`, `resolve_asset_path`, this scope grant, the
    // persisted `workspace.json`) working from the same already-canonical string.
    let canonical = std::fs::canonicalize(path)
        .map_err(|err| format!("failed to resolve workspace folder {}: {err}", path.display()))?;
    let canonical_path = canonical.to_string_lossy().into_owned();

    let config_dir = workspace_config_dir(&app)?;

    let state = app.state::<Mutex<WorkspaceConfig>>();
    let mut config = state.lock().map_err(|_| "workspace config lock poisoned".to_string())?;
    config.workspace_path = Some(canonical_path.clone());
    renote_storage::add_recent_workspace_path(&mut config, canonical_path.clone());
    renote_storage::save_workspace_config(&config_dir, &config).map_err(|err| err.to_string())?;

    // Phase 5.9 (image insertion): keep the asset protocol's runtime scope in sync with
    // whichever workspace is open — see `renote_lib::run()`'s setup hook, which grants this
    // once at startup for whatever workspace was already configured; a mid-session switch here
    // needs the exact same grant against the NEW path, or `resolve_asset_path`/`convertFileSrc`
    // would keep working (they don't check this scope themselves) while the WebView's actual
    // `asset://` fetch silently 403s against the old, now-stale scope.
    app.asset_protocol_scope()
        .allow_directory(&canonical_path, true)
        .map_err(|err| err.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn list_recent_workspace_paths<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    let state = app.state::<Mutex<WorkspaceConfig>>();
    let config = state.lock().map_err(|_| "workspace config lock poisoned".to_string())?;
    Ok(config.recent_workspace_paths.clone())
}
