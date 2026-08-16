//! Persists which folder the user has chosen as their notebook workspace,
//! plus a small "recently used" list, as `<config_dir>/workspace.json`.
//!
//! Rust-only, same as every other module in this crate — no `tauri`
//! dependency. The Tauri-side composition root (`src-tauri/src/lib.rs`)
//! decides *where* `config_dir` points (the platform app-config directory)
//! and owns the in-memory `Mutex<WorkspaceConfig>` app state; this module
//! only knows how to read/write the JSON file itself.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::StorageError;
use crate::json_io;

/// How many recently used workspace paths to remember.
const MAX_RECENT_WORKSPACE_PATHS: usize = 8;

const WORKSPACE_CONFIG_FILE: &str = "workspace.json";

/// The persisted shape of `<config_dir>/workspace.json`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfig {
    /// The currently open workspace's absolute folder path, or `None` if
    /// the user hasn't chosen one yet (first run, or a fresh install).
    pub workspace_path: Option<String>,
    /// Most-recently-used first, capped at `MAX_RECENT_WORKSPACE_PATHS`.
    pub recent_workspace_paths: Vec<String>,
}

/// Reads `<config_dir>/workspace.json`. Returns a default (empty) config —
/// not an error — if the file doesn't exist yet, mirroring how
/// `notebook::list_notebooks` treats a missing root directory as "empty".
pub fn load_workspace_config(config_dir: &Path) -> Result<WorkspaceConfig, StorageError> {
    let path = config_dir.join(WORKSPACE_CONFIG_FILE);
    match json_io::read_json(&path) {
        Ok(config) => Ok(config),
        Err(StorageError::Io { source, .. }) if source.kind() == std::io::ErrorKind::NotFound => {
            Ok(WorkspaceConfig::default())
        }
        Err(err) => Err(err),
    }
}

/// Writes `config` to `<config_dir>/workspace.json`, creating `config_dir`
/// if needed (via `json_io::write_json`).
pub fn save_workspace_config(
    config_dir: &Path,
    config: &WorkspaceConfig,
) -> Result<(), StorageError> {
    json_io::write_json(&config_dir.join(WORKSPACE_CONFIG_FILE), config)
}

/// Records `path` as the most-recently-used workspace: moves it to the
/// front of `recent_workspace_paths` (deduping an existing entry rather
/// than adding a second one), then truncates the list to
/// `MAX_RECENT_WORKSPACE_PATHS` entries.
pub fn add_recent_workspace_path(config: &mut WorkspaceConfig, path: String) {
    config.recent_workspace_paths.retain(|existing| existing != &path);
    config.recent_workspace_paths.insert(0, path);
    config.recent_workspace_paths.truncate(MAX_RECENT_WORKSPACE_PATHS);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_write_then_read() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config = WorkspaceConfig {
            workspace_path: Some("/home/user/notes".to_string()),
            recent_workspace_paths: vec![
                "/home/user/notes".to_string(),
                "/home/user/old".to_string(),
            ],
        };

        save_workspace_config(dir.path(), &config).unwrap();
        let loaded = load_workspace_config(dir.path()).unwrap();

        assert_eq!(loaded, config);
    }

    #[test]
    fn missing_file_returns_default_config() {
        let dir = tempfile::tempdir().expect("tempdir");

        let loaded = load_workspace_config(dir.path()).unwrap();

        assert_eq!(loaded, WorkspaceConfig::default());
    }

    #[test]
    fn missing_config_dir_also_returns_default_config() {
        let dir = tempfile::tempdir().expect("tempdir");
        let missing = dir.path().join("does-not-exist-yet");

        let loaded = load_workspace_config(&missing).unwrap();

        assert_eq!(loaded, WorkspaceConfig::default());
    }

    #[test]
    fn add_recent_workspace_path_moves_existing_entry_to_front() {
        let mut config = WorkspaceConfig {
            workspace_path: None,
            recent_workspace_paths: vec!["/a".to_string(), "/b".to_string(), "/c".to_string()],
        };

        add_recent_workspace_path(&mut config, "/b".to_string());

        assert_eq!(config.recent_workspace_paths, vec!["/b", "/a", "/c"]);
    }

    #[test]
    fn add_recent_workspace_path_caps_the_list_length() {
        let mut config = WorkspaceConfig::default();

        for i in 0..20 {
            add_recent_workspace_path(&mut config, format!("/path-{i}"));
        }

        assert_eq!(config.recent_workspace_paths.len(), MAX_RECENT_WORKSPACE_PATHS);
        // Most recently added stays first.
        assert_eq!(config.recent_workspace_paths[0], "/path-19");
    }
}
