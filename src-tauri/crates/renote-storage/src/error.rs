//! Crate-level error type. Every fallible public function in this crate
//! returns `Result<_, StorageError>` — no `unwrap()`/`panic!` in library
//! code paths (tests may use them for brevity).

use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("JSON error at {path}: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },

    /// Returned by the page schema-version upgrade dispatch (see
    /// `crate::page`) when a page's `schemaVersion` cannot be reconciled
    /// with `CURRENT_PAGE_SCHEMA_VERSION`: either it's older but no
    /// upgrader is registered to carry it forward, or it's newer than this
    /// build understands (no downgrade path exists).
    #[error(
        "cannot upgrade page schema: found version {found}, current is {current}, \
         no upgrader is registered for version {found}"
    )]
    UnsupportedSchemaVersion { found: u32, current: u32 },

    /// A stroke-point blob's byte length is not a multiple of 12 (3 ×
    /// little-endian f32 per point) — see `crate::blob` for the format.
    #[error("stroke blob at {path} has invalid length {len} bytes (must be a multiple of 12)")]
    InvalidBlobLength { path: PathBuf, len: usize },

    /// A zip read/write failure while creating or restoring a notebook
    /// backup archive — see `crate::backup`.
    #[error("archive error at {path}: {source}")]
    Zip {
        path: PathBuf,
        #[source]
        source: zip::result::ZipError,
    },

    /// A backup archive's `.renote-notebook.json` is missing, unreadable, or
    /// the archive contains a path that would escape the extraction root —
    /// i.e. it isn't a valid reNote notebook backup.
    #[error("invalid notebook backup archive at {path}: {reason}")]
    InvalidBackupArchive { path: PathBuf, reason: String },
}
