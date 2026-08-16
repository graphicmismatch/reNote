//! Small internal helpers for reading/writing a serde type as a JSON file,
//! with `StorageError` variants carrying path context. Used by the
//! notebook/section/page modules so each avoids repeating this
//! read-bytes/parse/write-bytes boilerplate.

use std::path::Path;

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::StorageError;

pub(crate) fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, StorageError> {
    let bytes = std::fs::read(path)
        .map_err(|source| StorageError::Io { path: path.to_path_buf(), source })?;
    serde_json::from_slice(&bytes)
        .map_err(|source| StorageError::Json { path: path.to_path_buf(), source })
}

pub(crate) fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), StorageError> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|source| StorageError::Json { path: path.to_path_buf(), source })?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|source| StorageError::Io { path: parent.to_path_buf(), source })?;
    }
    crate::util::write_file_atomic(path, &bytes)
}
