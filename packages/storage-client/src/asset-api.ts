import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  AssetRefDto,
  CopyPageAssetRequestDto,
  DeletePageAssetRequestDto,
  ResolveAssetPathRequestDto,
  SaveImageAssetRequestDto,
} from "./types.js";

export function saveImageAsset(request: SaveImageAssetRequestDto): Promise<AssetRefDto> {
  return invoke("save_image_asset", { request });
}

/** Where a just-recorded audio clip goes. No Rust `#[derive(TS)]` DTO backs this — see
 *  `saveAudioAsset`'s doc comment for why the fields ride along as headers instead of a JSON
 *  argument, which is also why this type is hand-written rather than `ts-rs`-generated. */
export interface SaveAudioAssetRequest {
  notebookId: string;
  sectionId: string;
  pageId: string;
  fileName: string;
}

/**
 * Saves a recorded clip's raw bytes as a page asset, returning the relative `assetPath` to store
 * on `AudioClipData.assetPath`. `bytes` goes over IPC as the request's raw body, not a JSON
 * field: an hour of Opus audio is 15-25MB, and JSON-encoding that (a number array, or base64)
 * would build/ship/parse 3-4x its size on a 4GB-RAM floor — see the plan's Appendix B. The
 * scalar fields ride along as request headers, the one place a raw-body invoke has left for them.
 */
export function saveAudioAsset(request: SaveAudioAssetRequest, bytes: Uint8Array): Promise<string> {
  return invoke("save_audio_asset", bytes, { headers: { ...request } });
}

/**
 * Resolves an `assetPath` (relative to its section, as stored on e.g. `ImageData.assetPath`)
 * to a URL the WebView can load pixel data from directly — a real, directly-fetchable `asset:`
 * URL here, NOT the bare absolute filesystem path the `resolve_asset_path` Tauri command
 * itself returns. `convertFileSrc` is applied here, once, at the storage-client boundary, so
 * every caller (canvas-engine's `ResolveAssetUrl` callback, ultimately) can treat
 * `StorageClient.resolveAssetPath` as "assetPath in, loadable URL out" without needing to know
 * Tauri's asset-protocol convention exists — `fake-storage-client.ts`'s implementation of the
 * same method returns an already-loadable `data:` URL for the exact same reason (see its own
 * doc comment for that divergence).
 */
export async function resolveAssetPath(request: ResolveAssetPathRequestDto): Promise<string> {
  const absolutePath = await invoke<string>("resolve_asset_path", { request });
  return convertFileSrc(absolutePath);
}

/**
 * Reads an audio clip's raw bytes, for the frontend to play back via `Blob`/`URL.createObjectURL`
 * rather than `resolveAssetPath`'s `asset://` URL — see `read_audio_asset`'s doc comment for why
 * audio specifically needs this: WebKitGTK's GStreamer `<audio>` backend can't load media through
 * Tauri's custom URI scheme on Linux, even though `resolveAssetPath` works fine for Pixi's plain
 * `fetch()`-based image loading. `invoke` resolves this to an `ArrayBuffer` since the command
 * returns a raw (non-JSON) response body.
 */
export function readAudioAsset(request: ResolveAssetPathRequestDto): Promise<ArrayBuffer> {
  return invoke("read_audio_asset", { request });
}

/** Copies an existing asset to another page, returning the new `assetPath` to store on the
 *  pasted object. See `CopyPageAssetRequestDto` for why a paste can't just reuse the old path. */
export function copyPageAsset(request: CopyPageAssetRequestDto): Promise<string> {
  return invoke("copy_page_asset", { request });
}

export function deletePageAsset(request: DeletePageAssetRequestDto): Promise<void> {
  return invoke("delete_page_asset", { request });
}
