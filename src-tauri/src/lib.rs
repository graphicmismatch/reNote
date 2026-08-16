// The Tauri bootstrap: wires plugins and delegates command registration to
// renote-commands, which owns the actual #[tauri::command] surface and its
// dependencies on renote-storage/renote-index/renote-export/renote-import.
// `tauri::generate_context!()` must be invoked here, in the crate that sits
// next to tauri.conf.json — Tauri resolves it relative to this crate's
// manifest directory.
//
// This crate also owns the one piece of shared, mutable app state every
// command in `renote-commands` depends on: which workspace folder is
// currently open (see `renote_commands::library::default_library_root`).
// It's set up once here, in `setup`, and handed to the command layer as
// managed `Mutex<renote_storage::WorkspaceConfig>` state rather than living
// in `renote-commands` itself, since composing Tauri app state is this
// crate's job as the composition root.

use std::sync::Mutex;

use tauri::Manager;

use renote_storage::WorkspaceConfig;

/// The legacy Phase 1-4 notebook folder, from before workspaces existed:
/// `<app-data-dir>/notebooks/`. Used only for the one-time migration below.
fn legacy_library_root(app: &tauri::App) -> Result<std::path::PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    Ok(data_dir.join("notebooks"))
}

/// `<app-config-dir>/renote`, where `workspace.json` lives. A subfolder of
/// the platform config dir (not the data dir, which is where notebooks
/// themselves default to) so it sits alongside other future app-level
/// (non-notebook-data) settings files.
fn workspace_config_dir(app: &tauri::App) -> Result<std::path::PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    Ok(config_dir.join("renote"))
}

/// Loads the persisted workspace config, migrating a pre-Phase-5.5 install
/// (one that already has notebooks directly under the legacy
/// `<app-data-dir>/notebooks/` folder, but has never chosen a workspace)
/// onto that legacy folder as its workspace, one time only.
fn load_and_migrate_workspace_config(app: &tauri::App) -> Result<WorkspaceConfig, String> {
    let config_dir = workspace_config_dir(app)?;
    let mut config =
        renote_storage::load_workspace_config(&config_dir).map_err(|err| err.to_string())?;

    if config.workspace_path.is_none() {
        let legacy_root = legacy_library_root(app)?;
        let has_legacy_notebooks = renote_storage::list_notebooks(&legacy_root)
            .map(|notebooks| !notebooks.is_empty())
            .unwrap_or(false);

        if has_legacy_notebooks {
            let canonical = std::fs::canonicalize(&legacy_root).map_err(|err| err.to_string())?;
            let canonical_str = canonical.to_string_lossy().into_owned();
            config.workspace_path = Some(canonical_str.clone());
            renote_storage::add_recent_workspace_path(&mut config, canonical_str);
            renote_storage::save_workspace_config(&config_dir, &config)
                .map_err(|err| err.to_string())?;
        }
    } else if let Some(workspace_path) = config.workspace_path.clone() {
        // Self-heal an already-persisted path from before `set_workspace_path` started
        // canonicalizing on write (see that command's doc comment for the full "raw vs.
        // canonical" scope-mismatch bug this closes): re-canonicalize whatever was loaded and
        // persist the result if it changed, so an existing install doesn't need the user to
        // manually re-pick their workspace folder just to fix asset loading. If canonicalize
        // fails (the folder no longer exists, e.g. an external drive that's currently
        // unplugged), leave the stored path exactly as-is — `default_library_root` already
        // surfaces "no workspace selected"-style errors for a genuinely missing folder, and
        // this is not the place to turn that into a hard startup failure.
        if let Ok(canonical) = std::fs::canonicalize(&workspace_path) {
            let canonical_str = canonical.to_string_lossy().into_owned();
            if canonical_str != workspace_path {
                config.workspace_path = Some(canonical_str.clone());
                renote_storage::add_recent_workspace_path(&mut config, canonical_str);
                renote_storage::save_workspace_config(&config_dir, &config)
                    .map_err(|err| err.to_string())?;
            }
        }
    }

    Ok(config)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config = load_and_migrate_workspace_config(app)
                .map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;
            // Phase 5.9 (image insertion): the asset protocol (`convertFileSrc`-loadable
            // `asset://` URLs) is enabled with an empty STATIC scope in tauri.conf.json — the
            // real scope is the user's chosen workspace folder, which only exists at runtime
            // and can change mid-session (Phase 5.5's workspace switcher). Grant it here for
            // whatever workspace `load_and_migrate_workspace_config` resolved (fresh install
            // with no workspace yet -> nothing to grant, matching `default_library_root`'s own
            // "no workspace selected" gate); `set_workspace_path` re-grants on every later
            // switch (see `renote_commands::workspace`).
            if let Some(workspace_path) = config.workspace_path.as_ref() {
                app.asset_protocol_scope()
                    .allow_directory(workspace_path, true)
                    .map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;
            }
            #[cfg(any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "openbsd"
            ))]
            {
                // WebKitGTK's `getUserMedia` (Phase 12's audio recording) routes through the
                // native `WebKitWebView::permission-request` GObject signal, which nothing
                // connects to by default — with no handler, WebKit's un-handled-signal default
                // is to leave the request pending forever rather than deny it, so the page's
                // `getUserMedia()` promise never resolves OR rejects: no error, no UI change,
                // "nothing happens" (this exact symptom, confirmed live). A first-party desktop
                // app showing only its own bundled page (never third-party/remote content) has
                // no untrusted origin to gate this per-site the way a browser would, so every
                // permission request (camera, mic, geolocation, notifications, ...) is granted
                // unconditionally here — the OS/desktop portal's own mic-access indicator and
                // the in-app Record Audio UI are the only "permission" surface that matters.
                if let Some(main_window) = app.get_webview_window("main") {
                    main_window
                        .with_webview(|platform_webview| {
                            use webkit2gtk::{PermissionRequestExt, WebViewExt};
                            platform_webview.inner().connect_permission_request(
                                |_webview, request| {
                                    request.allow();
                                    true
                                },
                            );
                        })
                        .map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;
                }
            }
            app.manage(Mutex::new(config));
            Ok(())
        });
    let builder = renote_commands::register(builder);
    builder.run(tauri::generate_context!()).expect("error while running the reNote application");
}
