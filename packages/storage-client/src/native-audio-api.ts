import { invoke } from "@tauri-apps/api/core";
import type { StopNativeAudioCaptureRequestDto } from "./types.js";

/**
 * Native microphone capture (Linux/BSD `MediaRecorder` fallback) — see `AppShell.tsx`'s
 * `handleRecordAudio` doc comment and `renote_audio`'s crate doc comment for why this path
 * exists alongside `saveAudioAsset`: WebKitGTK's browser-side `MediaRecorder` depends on
 * GStreamer plugins that are not reliably present on a plain Linux desktop install, so on that
 * platform the frontend captures via these two commands instead, entirely in Rust.
 */
export function startNativeAudioCapture(): Promise<void> {
  return invoke("start_native_audio_capture");
}

/** Stops native capture, encodes it as WAV, and saves it as a page asset — returns the new
 *  `assetPath`, the same shape `saveAudioAsset` resolves to. */
export function stopNativeAudioCapture(request: StopNativeAudioCaptureRequestDto): Promise<string> {
  return invoke("stop_native_audio_capture", { request });
}
