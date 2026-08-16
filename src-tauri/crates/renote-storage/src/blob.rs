//! Binary point-blob format for ink strokes, referenced by
//! `InkStrokeData.pointDataAssetPath` in a page's JSON.
//!
//! ## Layout
//! A flat sequence of little-endian `f32` triples `[x, y, pressure]`, with
//! no header, magic bytes, or length prefix: point count is simply
//! `file_size_bytes / 12` (3 × 4-byte floats per point). This is
//! deliberately minimal — this crate's job is byte-faithful round-tripping
//! of "here are the points", not stroke smoothing/tessellation/rendering
//! (that's canvas-engine's job in a later phase).
//!
//! Stroke blobs for a page live at `assets/<pageId>/strokes/<strokeId>.bin`
//! (see [`strokes_dir`]), alongside that page's other assets (see
//! `crate::asset`).

use std::path::{Path, PathBuf};

use crate::asset;
use crate::error::StorageError;
use crate::util;

const BYTES_PER_POINT: usize = 12; // 3 * f32

/// The `assets/<pageId>/strokes/` folder a page's stroke blobs live under.
pub fn strokes_dir(section_dir: &Path, page_id: &str) -> PathBuf {
    asset::page_assets_dir(section_dir, page_id).join("strokes")
}

/// Writes `points` as a packed binary blob for the given stroke, creating
/// the `strokes/` folder if needed. Returns the path to store in
/// `InkStrokeData.pointDataAssetPath`, relative to `section_dir` (the
/// folder the page's own JSON file lives in).
pub fn write_stroke_blob(
    section_dir: &Path,
    page_id: &str,
    stroke_id: &str,
    points: &[(f32, f32, f32)],
) -> Result<String, StorageError> {
    let dir = strokes_dir(section_dir, page_id);
    std::fs::create_dir_all(&dir)
        .map_err(|source| StorageError::Io { path: dir.clone(), source })?;

    let path = dir.join(format!("{stroke_id}.bin"));
    let mut bytes = Vec::with_capacity(points.len() * BYTES_PER_POINT);
    for (x, y, pressure) in points {
        bytes.extend_from_slice(&x.to_le_bytes());
        bytes.extend_from_slice(&y.to_le_bytes());
        bytes.extend_from_slice(&pressure.to_le_bytes());
    }
    util::write_file_atomic(&path, &bytes)?;

    util::relative_to(section_dir, &path)
}

/// Reads a stroke's packed binary blob back into `(x, y, pressure)`
/// triples. `relative_path` is the value stored in
/// `InkStrokeData.pointDataAssetPath` (relative to `section_dir`).
pub fn read_stroke_blob(
    section_dir: &Path,
    relative_path: &str,
) -> Result<Vec<(f32, f32, f32)>, StorageError> {
    let path = section_dir.join(relative_path);
    let bytes =
        std::fs::read(&path).map_err(|source| StorageError::Io { path: path.clone(), source })?;

    if bytes.len() % BYTES_PER_POINT != 0 {
        return Err(StorageError::InvalidBlobLength { path, len: bytes.len() });
    }

    let mut points = Vec::with_capacity(bytes.len() / BYTES_PER_POINT);
    for chunk in bytes.chunks_exact(BYTES_PER_POINT) {
        let x = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        let y = f32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]]);
        let pressure = f32::from_le_bytes([chunk[8], chunk[9], chunk[10], chunk[11]]);
        points.push((x, y, pressure));
    }

    Ok(points)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_points_through_the_binary_format() {
        let dir = tempfile::tempdir().expect("tempdir");
        let points = vec![(0.0_f32, 0.0, 0.0), (12.5, -3.25, 0.75), (100.0, 200.0, 1.0)];

        let relative = write_stroke_blob(dir.path(), "page-1", "stroke-1", &points).unwrap();
        assert_eq!(relative, "assets/page-1/strokes/stroke-1.bin");

        let read_back = read_stroke_blob(dir.path(), &relative).unwrap();
        assert_eq!(read_back, points);
    }

    #[test]
    fn rejects_a_truncated_blob() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bad_path = dir.path().join("truncated.bin");
        std::fs::write(&bad_path, [0u8; 10]).unwrap();

        let err = read_stroke_blob(dir.path(), "truncated.bin").unwrap_err();
        assert!(matches!(err, StorageError::InvalidBlobLength { len: 10, .. }));
    }
}
