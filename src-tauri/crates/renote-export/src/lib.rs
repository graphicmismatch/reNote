//! PDF export reconstructed from the page-object model (not WebView print-to-PDF, per the
//! project plan's decision), plus plain-text export.
//!
//! Rust-only — no `tauri`/`renote-commands` dependency (the command layer wraps this crate, not
//! the other way around; see this workspace's crate-boundary conventions). Depends on
//! `renote-storage` for reading a page's ink-stroke point blobs and image/attachment asset
//! bytes.
//!
//! See [`pdf`]'s module doc comment for the PDF renderer's fidelity simplifications, and
//! [`text::export_page_plain_text`] for the plain-text export.

mod error;
mod markdown;
mod pdf;
mod text;

pub use error::ExportError;
pub use markdown::{export_page_markdown, export_pages_to_markdown};
pub use pdf::{export_page_to_pdf, export_pages_to_pdf};
pub use text::export_page_plain_text;
