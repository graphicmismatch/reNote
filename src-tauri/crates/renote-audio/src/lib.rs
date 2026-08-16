//! Native microphone capture for Phase 12's audio clips, via `cpal` (cross-platform audio I/O)
//! encoded as WAV via `hound` (pure Rust, zero dependencies of its own).
//!
//! ## Why this exists
//! The original design (the project plan's Appendix B) used the browser's own `MediaRecorder`
//! API, encoding Opus/AAC "for free" with zero new Rust dependencies — and that works on
//! Windows/macOS. On Linux it depends on WebKitGTK's GStreamer-backed `MediaRecorder`
//! implementation, which needs the `fmp4`/`isobmff` plugins from the `gst-plugins-rs` project —
//! plugins that are not packaged by Debian or Ubuntu under any name as of this writing (checked
//! directly against Ubuntu's Contents index, not assumed). Where they're missing, WebKitGTK's
//! `MediaRecorder` still reports success and still hands back a "live" `MediaStreamTrack`, but
//! the recorder never emits a single non-empty `dataavailable` event, for any container/codec —
//! a silent, total failure with no JS-visible error. Confirmed live via `GST_DEBUG` output: the
//! audio source pad fails to link inside WebKit's fallback encoding pipeline
//! (`gst_base_src_loop: streaming stopped, reason not-linked (-1)`), not a hypothetical gap.
//!
//! `cpal` sidesteps WebKitGTK/GStreamer entirely: it talks to the OS audio API directly (ALSA on
//! Linux, which PipeWire's near-universal ALSA-compatibility layer already backs — no GStreamer
//! plugin of any kind needed at runtime). WAV, not Opus/AAC: it needs no encoder at all, trading
//! file size (WAV is roughly 10MB/minute vs. Opus' 2-3MB/minute) for zero runtime codec
//! dependency, which is the entire point of this crate existing.
//!
//! `renote-commands::audio` calls the real implementation below only on Linux/BSD, keeping the
//! original `MediaRecorder` path for Windows/macOS where it already works reliably — see that
//! module's doc comment for the frontend-side platform split.

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
mod native;
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
pub use native::{AudioCapture, AudioCaptureError};

#[cfg(not(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
)))]
mod unsupported;
#[cfg(not(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
)))]
pub use unsupported::{AudioCapture, AudioCaptureError};
