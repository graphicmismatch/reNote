//! Internal helpers shared by the notebook/section/page/asset modules:
//! ID/timestamp generation, filesystem-safe name sanitization, and
//! relative-path computation. Not part of the crate's public surface.

use std::path::Path;

use crate::error::StorageError;

/// Generates a new random ID (a UUID v4 string) for a Notebook/Section/
/// SectionGroup/Page/PageObject. Public (not just `pub(crate)`) because
/// `renote-commands` needs it too, to mint fresh object ids when copying a
/// template page's objects onto a new page (see `crate::page::create_page`'s
/// callers) — every other object id on the wire comes from the frontend, this
/// is the one server-side exception.
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Current time as an ISO 8601 / RFC 3339 timestamp string, matching the
/// `createdAt`/`modifiedAt` string fields on the TypeScript side.
pub(crate) fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Replaces characters that are unsafe/reserved in filesystem path
/// components (on at least one of Windows/macOS/Linux) with `_`, trims
/// whitespace, and falls back to `"untitled"` if the result is empty.
/// Unicode letters/spaces are otherwise preserved for human-readability.
pub(crate) fn sanitize_component(name: &str) -> String {
    let trimmed = name.trim();
    let mut out = String::with_capacity(trimmed.len());
    for c in trimmed.chars() {
        if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            out.push('_');
        } else {
            out.push(c);
        }
    }
    let out = out.trim().to_string();
    if out.is_empty() {
        "untitled".to_string()
    } else {
        out
    }
}

/// Picks a directory name under `parent` derived from `name`, appending a
/// numeric suffix (`-2`, `-3`, ...) until it doesn't collide with an
/// existing entry. Used for notebook folders, the only folders in this
/// crate named after user-supplied text rather than an ID (see crate docs).
pub(crate) fn unique_dir_name(parent: &Path, name: &str) -> String {
    let base = sanitize_component(name);
    let mut candidate = base.clone();
    let mut suffix = 2;
    while parent.join(&candidate).exists() {
        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }
    candidate
}

/// Picks a file name under `dir` derived from `suggested`, preserving the
/// extension and appending a numeric suffix before it on collision, e.g.
/// `photo.png` -> `photo-2.png`.
pub(crate) fn unique_file_name(dir: &Path, suggested: &str) -> String {
    let sanitized = sanitize_component(suggested);
    let path = Path::new(&sanitized);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file").to_string();
    let ext = path.extension().and_then(|s| s.to_str()).map(str::to_string);

    let mut candidate = sanitized.clone();
    let mut suffix = 2;
    while dir.join(&candidate).exists() {
        candidate = match &ext {
            Some(ext) => format!("{stem}-{suffix}.{ext}"),
            None => format!("{stem}-{suffix}"),
        };
        suffix += 1;
    }
    candidate
}

/// Writes `bytes` to `path` atomically and durably: into a temp file in the
/// *same* directory (a rename must not cross devices), fsynced, then renamed
/// over the target, then the parent directory itself fsynced. A crash or power
/// loss can therefore leave the old file or the new one, never a truncated
/// mix — which matters because the frontend's debounced save rewrites a whole
/// page document through this path.
///
/// The temp name is deterministic (`.<file_name>.tmp`), so a crash between the
/// write and the rename leaves at most one stale temp per file, overwritten by
/// the next save — no cleanup code. It can't confuse the existing scans either:
/// `list_pages` matches on the `.page.json` suffix, which a `.tmp` name fails.
///
// ponytail: fsync, not F_FULLFSYNC — survives an app crash, not a power cut
// mid-write on macOS (APFS flushes to the drive cache, not through it).
// F_FULLFSYNC is the real barrier but costs 10-100ms per save.
pub(crate) fn write_file_atomic(path: &Path, bytes: &[u8]) -> Result<(), StorageError> {
    let io_err = |p: &Path| {
        let p = p.to_path_buf();
        move |source| StorageError::Io { path: p.clone(), source }
    };

    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let temp_path = parent.join(format!(".{file_name}.tmp"));

    let file = std::fs::File::create(&temp_path).map_err(io_err(&temp_path))?;
    {
        use std::io::Write;
        let mut writer = std::io::BufWriter::new(&file);
        writer.write_all(bytes).map_err(io_err(&temp_path))?;
        writer.flush().map_err(io_err(&temp_path))?;
    }
    file.sync_all().map_err(io_err(&temp_path))?;
    drop(file);

    // On Windows this maps to MoveFileEx + MOVEFILE_REPLACE_EXISTING, which
    // fails (rather than corrupts) when a sync client or antivirus holds the
    // destination open. No retry loop — the backend is synchronous, and the
    // frontend's save already catches and re-fires on the next change.
    std::fs::rename(&temp_path, path).map_err(io_err(path))?;
    fsync_dir(parent);
    Ok(())
}

/// POSIX doesn't guarantee a rename is durable until the parent directory is
/// fsynced. Best-effort: a failure here means the rename may not survive a
/// power cut, but the file itself is already intact, so it isn't worth failing
/// the write over. No-op off Unix, where opening a directory needs
/// `FILE_FLAG_BACKUP_SEMANTICS` (and NTFS's journal mostly closes the gap).
#[cfg(unix)]
fn fsync_dir(dir: &Path) {
    if let Ok(handle) = std::fs::File::open(dir) {
        let _ = handle.sync_all();
    }
}

#[cfg(not(unix))]
fn fsync_dir(_dir: &Path) {}

/// Computes `target`'s path relative to `base`, with path separators
/// normalized to `/` so the stored relative-path strings (e.g.
/// `PageObject.data.assetPath`) are consistent across platforms.
pub(crate) fn relative_to(base: &Path, target: &Path) -> Result<String, StorageError> {
    target.strip_prefix(base).map(|rel| rel.to_string_lossy().replace('\\', "/")).map_err(|_| {
        StorageError::Io {
            path: target.to_path_buf(),
            source: std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("{} is not under {}", target.display(), base.display()),
            ),
        }
    })
}

/// Canonicalizes `path` and renders it as a `String`, for the `Notebook.path`
/// field (the only model struct that stores an absolute filesystem path).
pub(crate) fn canonical_path_string(path: &Path) -> Result<String, StorageError> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|source| StorageError::Io { path: path.to_path_buf(), source })?;
    Ok(canonical.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_content_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("page.json");

        write_file_atomic(&path, b"first").expect("first write");
        assert_eq!(std::fs::read(&path).unwrap(), b"first");

        // Overwriting a longer file with a shorter one must not leave a tail
        // of the old content behind, the way a partial in-place write could.
        write_file_atomic(&path, b"2nd").expect("second write");
        assert_eq!(std::fs::read(&path).unwrap(), b"2nd");

        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp file left behind: {leftovers:?}");
    }
}
