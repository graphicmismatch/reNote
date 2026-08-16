/// Proves the command-registration wiring end to end. The real
/// notebook/page/search commands live in `crate::notebook`/`crate::page`/
/// `crate::search`.
#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
