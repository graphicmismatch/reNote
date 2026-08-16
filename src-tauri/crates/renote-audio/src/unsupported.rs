//! Stub implementation for platforms where the frontend never calls into this crate at all
//! (Windows/macOS keep using `MediaRecorder`, see `renote-commands::audio`'s doc comment) — this
//! exists purely so `renote-audio` (and anything depending on it) still builds and typechecks on
//! every CI/dev platform, not just Linux/BSD.

#[derive(Debug, thiserror::Error)]
pub enum AudioCaptureError {
    #[error("native audio capture is not implemented on this platform")]
    Unsupported,
}

pub struct AudioCapture {
    _private: (),
}

impl AudioCapture {
    pub fn start() -> Result<Self, AudioCaptureError> {
        Err(AudioCaptureError::Unsupported)
    }

    pub fn finish(self) -> Result<Vec<u8>, AudioCaptureError> {
        Err(AudioCaptureError::Unsupported)
    }
}
