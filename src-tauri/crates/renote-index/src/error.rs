//! Crate-level error type. Every fallible public function in this crate
//! returns `Result<_, IndexError>` — no `unwrap()`/`panic!` in library code
//! paths (tests may use them for brevity).

use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum IndexError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("storage error while rebuilding the index: {0}")]
    Storage(#[from] renote_storage::StorageError),
}
