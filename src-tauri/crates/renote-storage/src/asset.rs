//! Generic per-page asset file I/O: images, audio, file attachments — any
//! raw bytes referenced by an `assetPath`-shaped field on a `PageObject`'s
//! `data`. Ink stroke point blobs have their own dedicated binary
//! format/helpers in `crate::blob`, but both live under the same
//! `assets/<pageId>/` folder scheme, rooted at the section folder the
//! page's own `<pageId>.page.json` lives in.

use std::path::{Path, PathBuf};

use crate::error::StorageError;
use crate::util;

/// The `assets/<pageId>/` folder a page's binary blobs live under.
pub fn page_assets_dir(section_dir: &Path, page_id: &str) -> PathBuf {
    section_dir.join("assets").join(page_id)
}

/// Writes `bytes` as a new asset file for the given page, creating the
/// `assets/<pageId>/` folder if needed and de-duplicating `suggested_file_name`
/// against existing files. Returns the path to store in the corresponding
/// `PageObject.data.assetPath` field, relative to `section_dir`.
pub fn write_asset(
    section_dir: &Path,
    page_id: &str,
    suggested_file_name: &str,
    bytes: &[u8],
) -> Result<String, StorageError> {
    let dir = page_assets_dir(section_dir, page_id);
    std::fs::create_dir_all(&dir)
        .map_err(|source| StorageError::Io { path: dir.clone(), source })?;

    let file_name = util::unique_file_name(&dir, suggested_file_name);
    let path = dir.join(&file_name);
    util::write_file_atomic(&path, bytes)?;

    util::relative_to(section_dir, &path)
}

/// Reads an asset's raw bytes back given its `assetPath` (relative to
/// `section_dir`).
pub fn read_asset(section_dir: &Path, relative_path: &str) -> Result<Vec<u8>, StorageError> {
    let path = section_dir.join(relative_path);
    std::fs::read(&path).map_err(|source| StorageError::Io { path, source })
}

/// Deletes a single asset file given its `assetPath` (relative to
/// `section_dir`). Plain filesystem removal — no recycle bin (out of
/// scope for Phase 1).
pub fn delete_asset(section_dir: &Path, relative_path: &str) -> Result<(), StorageError> {
    let path = section_dir.join(relative_path);
    std::fs::remove_file(&path).map_err(|source| StorageError::Io { path, source })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_asset_bytes_and_dedupes_on_name_collision() {
        let dir = tempfile::tempdir().expect("tempdir");

        let first = write_asset(dir.path(), "page-1", "photo.png", b"first").unwrap();
        assert_eq!(first, "assets/page-1/photo.png");

        // Same suggested name again -> must not clobber the first file.
        let second = write_asset(dir.path(), "page-1", "photo.png", b"second").unwrap();
        assert_ne!(second, first);

        assert_eq!(read_asset(dir.path(), &first).unwrap(), b"first");
        assert_eq!(read_asset(dir.path(), &second).unwrap(), b"second");

        delete_asset(dir.path(), &first).unwrap();
        assert!(read_asset(dir.path(), &first).is_err());
        assert_eq!(read_asset(dir.path(), &second).unwrap(), b"second");
    }
}
