//! Asset commands: thin wrappers delegating to `renote_storage::asset`'s
//! generic per-page binary file I/O (images today; any future
//! `assetPath`-shaped field — audio, file attachments — can reuse the same
//! three commands). Mirrors `crate::page`'s "resolve `section_dir`, delegate,
//! `.map_err(ToString::to_string)`" shape.
//!
//! `save_image_asset` reads `request.source_path` itself, in Rust, via
//! `std::fs::read` — see `SaveImageAssetRequestDto`'s doc comment for why
//! that's required rather than having the frontend read it (the source path
//! is an arbitrary user-picked file, almost never inside the Tauri
//! asset-protocol's workspace-scoped read permission). It also probes the
//! image's pixel dimensions via the `image` crate while it already has the
//! bytes in hand, avoiding a second, redundant read.
//!
//! `resolve_asset_path` returns an absolute, canonicalized filesystem path,
//! not bytes — the frontend feeds it straight into Tauri's `convertFileSrc`
//! so the WebView fetches the bytes itself over the asset protocol, rather
//! than round-tripping them through `invoke`'s JSON bridge a second time.
//! For that URL to actually resolve, the asset protocol's runtime scope
//! must already include this path's directory — see `renote_lib::run()`'s
//! setup hook and `crate::workspace::set_workspace_path`, which both call
//! `app.asset_protocol_scope().allow_directory(...)` against the current
//! workspace root. This is exactly the restriction `save_image_asset`
//! sidesteps for its SOURCE read above: the WRITTEN copy lives under
//! `section_dir` (already inside the workspace, so IS scope-covered for
//! this later read-back), but the original picked file generally isn't.

use tauri::ipc::{InvokeBody, Request};
use tauri::Runtime;

use crate::dto::{
    AssetRefDto, CopyPageAssetRequestDto, DeletePageAssetRequestDto, ResolveAssetPathRequestDto,
    SaveImageAssetRequestDto,
};
use crate::library;

#[tauri::command]
pub fn save_image_asset<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: SaveImageAssetRequestDto,
) -> Result<AssetRefDto, String> {
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;

    let source_path = std::path::Path::new(&request.source_path);
    let bytes = std::fs::read(source_path)
        .map_err(|err| format!("failed to read {}: {err}", source_path.display()))?;

    let (natural_width, natural_height) = image::ImageReader::open(source_path)
        .and_then(|reader| reader.with_guessed_format())
        .map_err(|err| format!("failed to read {}: {err}", source_path.display()))?
        .into_dimensions()
        .map_err(|err| format!("failed to read image dimensions: {err}"))?;

    let file_name =
        source_path.file_name().and_then(|name| name.to_str()).unwrap_or("image").to_string();

    let asset_path =
        renote_storage::write_asset(&section_dir, &request.page_id, &file_name, &bytes)
            .map_err(|err| err.to_string())?;

    Ok(AssetRefDto { asset_path, natural_width, natural_height })
}

/// Saves a recorded audio clip's bytes as a page asset, returning the relative `assetPath` to
/// store on `AudioClipData.assetPath`. Unlike `save_image_asset`, the bytes arrive as the
/// request's RAW body rather than a JSON field: a recording is tens of MB, and JSON-encoding
/// that (a number array, or base64) would build/ship/parse 3-4x its size — the frontend instead
/// calls `invoke("save_audio_asset", uint8Array, { headers: {...} })`, which Tauri delivers here
/// as `InvokeBody::Raw` with the scalar fields riding along as headers (a raw-body invoke has no
/// room for a second JSON argument). No duration probe here: the frontend already knows the
/// recording's wall-clock length and sends it straight into `AudioClipData.durationSeconds`
/// without a Rust round-trip.
#[tauri::command]
pub fn save_audio_asset<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: Request<'_>,
) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("save_audio_asset expects a raw byte body".to_string());
    };

    let header = |name: &str| -> Result<String, String> {
        request
            .headers()
            .get(name)
            .ok_or_else(|| format!("save_audio_asset: missing \"{name}\" header"))?
            .to_str()
            .map(str::to_string)
            .map_err(|err| format!("save_audio_asset: invalid \"{name}\" header: {err}"))
    };
    let notebook_id = header("notebookId")?;
    let section_id = header("sectionId")?;
    let page_id = header("pageId")?;
    let file_name = header("fileName")?;

    let (_notebook, section_dir) = library::resolve_section_dir(&app, &notebook_id, &section_id)?;
    renote_storage::write_asset(&section_dir, &page_id, &file_name, bytes)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn resolve_asset_path<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ResolveAssetPathRequestDto,
) -> Result<String, String> {
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let path = section_dir.join(&request.asset_path);
    let canonical = std::fs::canonicalize(&path)
        .map_err(|err| format!("failed to resolve asset path {}: {err}", path.display()))?;
    Ok(canonical.to_string_lossy().into_owned())
}

/// Reads an audio clip's raw bytes for the frontend to play back via `Blob`/`URL.createObjectURL`
/// instead of `resolve_asset_path`'s `asset://` URL. Needed because WebKitGTK's GStreamer-backed
/// `<audio>` element cannot load media through Tauri's custom `asset://` URI scheme on Linux —
/// confirmed live: `MediaPlayerPrivateGStreamer` reports a `FormatError` for a perfectly valid
/// WAV file loaded that way (verified independently with `gst-discoverer-1.0`/`gst-launch-1.0`
/// against the exact same file), even though `resolve_asset_path`'s URL works fine for Pixi's
/// plain `fetch()`-based image loading, which never touches GStreamer. Returned as a raw IPC
/// response body (not JSON) so a multi-MB recording doesn't pay JSON/number-array encoding
/// overhead — see `save_audio_asset`'s doc comment for the same reasoning on the write side.
#[tauri::command]
pub fn read_audio_asset<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ResolveAssetPathRequestDto,
) -> Result<tauri::ipc::Response, String> {
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let bytes = renote_storage::read_asset(&section_dir, &request.asset_path)
        .map_err(|err| err.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Copies an existing asset to another page, returning the NEW `assetPath` (relative to the
/// destination section) for the caller to write into the pasted object's `data.assetPath`.
/// Reuses `write_asset`, so the copy gets a deduplicated file name of its own and the two pages
/// never share a file — see `CopyPageAssetRequestDto`'s doc comment.
#[tauri::command]
pub fn copy_page_asset<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: CopyPageAssetRequestDto,
) -> Result<String, String> {
    let (_source_notebook, source_section_dir) = library::resolve_section_dir(
        &app,
        &request.source_notebook_id,
        &request.source_section_id,
    )?;
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;

    let bytes = renote_storage::read_asset(&source_section_dir, &request.source_asset_path)
        .map_err(|err| err.to_string())?;

    let file_name = std::path::Path::new(&request.source_asset_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("asset")
        .to_string();

    renote_storage::write_asset(&section_dir, &request.page_id, &file_name, &bytes)
        .map_err(|err| err.to_string())
}

/// `request.page_id` isn't strictly needed by `renote_storage::delete_asset` (a relative
/// `assetPath` is already unambiguous within `section_dir`), but is kept on the DTO for
/// symmetry with `save_image_asset`/every other page-scoped asset request, and as a seam for
/// a future "verify this asset actually belongs to this page" check if that's ever needed.
#[tauri::command]
pub fn delete_page_asset<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: DeletePageAssetRequestDto,
) -> Result<(), String> {
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    renote_storage::delete_asset(&section_dir, &request.asset_path).map_err(|err| err.to_string())
}
