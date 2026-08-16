use std::fmt;

/// Errors from PDF/plain-text export. Wraps `renote_storage::StorageError` (reading a page's
/// blobs/assets can fail the same way any other storage read can) plus an image-decode failure
/// specific to embedding an `image` object into a PDF.
#[derive(Debug)]
pub enum ExportError {
    Storage(renote_storage::StorageError),
    /// `printpdf::RawImage::decode_from_bytes` failed for the asset at `path` (relative to the
    /// page's section folder).
    Image {
        path: String,
        message: String,
    },
}

impl fmt::Display for ExportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Storage(err) => write!(f, "{err}"),
            Self::Image { path, message } => {
                write!(f, "failed to decode image asset {path}: {message}")
            }
        }
    }
}

impl std::error::Error for ExportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Storage(err) => Some(err),
            Self::Image { .. } => None,
        }
    }
}

impl From<renote_storage::StorageError> for ExportError {
    fn from(err: renote_storage::StorageError) -> Self {
        Self::Storage(err)
    }
}
