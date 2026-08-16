//! Native microphone capture commands — the Linux/BSD fallback for Phase 12's audio clips. See
//! `renote_audio`'s crate doc comment for the full "why does this exist at all" story:
//! WebKitGTK's browser-side `MediaRecorder` depends on GStreamer plugins that are not reliably
//! present on a plain Linux desktop install (confirmed live, not hypothetical), so the frontend
//! detects that platform and calls these two commands instead of `save_audio_asset` — see
//! `AppShell.tsx`'s `handleRecordAudio`/`handleStopRecording`.
//!
//! Two commands, not one raw-body upload like `save_audio_asset`: the audio bytes never leave
//! Rust here (captured, encoded, AND written to disk all server-side), so there's nothing for
//! the frontend to send except "start" and "stop, and save it onto this page".

use std::sync::Mutex;

use tauri::Runtime;

use crate::dto::StopNativeAudioCaptureRequestDto;
use crate::library;

/// Managed app state: at most one capture in progress at a time, matching the frontend's own
/// `isRecording` gate (the Record Audio button is disabled while already recording).
#[derive(Default)]
pub struct AudioCaptureState(pub Mutex<Option<renote_audio::AudioCapture>>);

#[tauri::command]
pub fn start_native_audio_capture(
    state: tauri::State<'_, AudioCaptureState>,
) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|_| "audio capture state poisoned".to_string())?;
    if slot.is_some() {
        return Err("a recording is already in progress".to_string());
    }
    *slot = Some(renote_audio::AudioCapture::start().map_err(|err| err.to_string())?);
    Ok(())
}

/// Stops the in-progress capture, encodes it as WAV, and writes it as a page asset — returning
/// the relative `assetPath` to store on `AudioClipData.assetPath`, exactly like
/// `save_audio_asset`'s return shape. `request.page_id` mints its own timestamped file name
/// rather than accepting one from the frontend (see `StopNativeAudioCaptureRequestDto`'s doc
/// comment for why: nothing client-side ever handles these bytes to name them).
#[tauri::command]
pub fn stop_native_audio_capture<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AudioCaptureState>,
    request: StopNativeAudioCaptureRequestDto,
) -> Result<String, String> {
    let capture = {
        let mut slot = state.0.lock().map_err(|_| "audio capture state poisoned".to_string())?;
        slot.take().ok_or_else(|| "no recording is in progress".to_string())?
    };
    let bytes = capture.finish().map_err(|err| err.to_string())?;

    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let file_name = format!("recording-{}.wav", now_ms());
    renote_storage::write_asset(&section_dir, &request.page_id, &file_name, &bytes)
        .map_err(|err| err.to_string())
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
