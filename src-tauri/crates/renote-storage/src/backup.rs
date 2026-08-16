//! Notebook backup/restore as a self-contained archive (zip).
//!
//! A backup archive is a flat zip of one notebook directory's contents —
//! `.renote-notebook.json`, section/section-group folders, page JSON,
//! stroke blobs, assets — with paths stored relative to the notebook root,
//! so the folder name at restore time doesn't need to match the folder name
//! at backup time. `.renote-index/` (the derived SQLite index — see
//! `renote_index`, not a dependency of this crate by design, see this
//! crate's module doc comment) is deliberately excluded: it's rebuildable
//! from a scan, and archiving it would bake in a snapshot that's stale the
//! moment the notebook changes again, or that may be mid-write. The caller
//! (`renote-commands`) is responsible for (re)initializing the notebook's
//! index after a restore, exactly like it already does after
//! `create_notebook`.
//!
//! Restoring never overwrites an existing notebook: the destination folder
//! name is freshly deduped (via [`util::unique_dir_name`]) against the
//! archived notebook's own `name` (read from the extracted marker file), so
//! restoring the same backup twice — or restoring while the original
//! notebook still exists — always produces a new, separate notebook rather
//! than silently clobbering one.
//!
//! A page/section/section-group a user has trashed is **not** in the
//! archive: `crate::trash` moves trashed items out to `<library-root>/.renote-trash/`,
//! a sibling of the notebook folder rather than something nested inside it,
//! so the walk below never sees it. This is the natural reading of "trashed
//! means deleted", but it's worth stating plainly: backing up a notebook
//! after trashing a page, then restoring elsewhere, does not bring that
//! page back — the trash bin itself isn't backed up.
//!
//! `.renote-autosave/` (each page's single autosave slot — see
//! `crate::autosave`) is **also** excluded, for a different reason than
//! trash: it's not deleted content, it's a local-only extra copy. It
//! carries its own copied assets (see that module's doc comment on why
//! asset copies are necessary), adding bytes with zero benefit to "restore
//! current state elsewhere" — a backup archive already contains the
//! CURRENT page content, which is all a restore-on-another-machine
//! scenario needs. Autosave stays a separate, local-only feature, same as
//! the derived search index.

use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::StorageError;
use crate::model::Notebook;
use crate::notebook::NOTEBOOK_MARKER_FILE;
use crate::{json_io, util};

/// Mirrors `renote_index::INDEX_DIR_NAME`, duplicated here rather than
/// depending on `renote-index` (this crate never depends on the derived
/// index — see the crate's top-level module doc comment).
const INDEX_DIR_NAME: &str = ".renote-index";

/// Mirrors `crate::autosave::AUTOSAVE_DIR_NAME`, duplicated as a local
/// constant for the same reason `INDEX_DIR_NAME` is: this module's
/// exclusion list is meant to read as self-contained, not require chasing
/// another module to know what it skips.
const AUTOSAVE_DIR_NAME: &str = ".renote-autosave";

/// Folder names that a backup archive must never include, wherever they
/// appear in a notebook's tree — each for its own reason, see this module's
/// doc comment. `.renote-index/` only ever sits at the notebook root, but
/// `.renote-autosave/` sits per-section (a sibling of that section's own
/// `assets/`, nested arbitrarily deep under section groups), so the check
/// below matches on ANY path component, not just the first.
const EXCLUDED_DIR_NAMES: &[&str] = &[INDEX_DIR_NAME, AUTOSAVE_DIR_NAME];

fn zip_err(path: &Path, source: zip::result::ZipError) -> StorageError {
    StorageError::Zip { path: path.to_path_buf(), source }
}

/// Archives `notebook_dir` (a notebook's own resolved root folder) into a
/// zip file at `dest_archive_path`, excluding the derived `.renote-index/`
/// folder. `dest_archive_path`'s parent directories are created if missing;
/// an existing file at that path is overwritten (the destination is a path
/// the caller/user picked explicitly, e.g. via a save-file dialog — unlike
/// restore, there's no ambiguity to guard against here).
pub fn create_notebook_archive(
    notebook_dir: &Path,
    dest_archive_path: &Path,
) -> Result<(), StorageError> {
    if let Some(parent) = dest_archive_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|source| StorageError::Io { path: parent.to_path_buf(), source })?;
    }

    let file = File::create(dest_archive_path)
        .map_err(|source| StorageError::Io { path: dest_archive_path.to_path_buf(), source })?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    for entry in WalkDir::new(notebook_dir).into_iter() {
        let entry = entry.map_err(|err| {
            let path = err.path().unwrap_or(notebook_dir).to_path_buf();
            StorageError::Io { path, source: std::io::Error::from(err) }
        })?;
        let path = entry.path();
        if path == notebook_dir {
            continue;
        }

        let rel = util::relative_to(notebook_dir, path)?;
        if rel.split('/').any(|component| EXCLUDED_DIR_NAMES.contains(&component)) {
            continue;
        }

        if entry.file_type().is_dir() {
            zip.add_directory(format!("{rel}/"), options)
                .map_err(|source| zip_err(dest_archive_path, source))?;
        } else {
            zip.start_file(&rel, options).map_err(|source| zip_err(dest_archive_path, source))?;
            let mut buf = Vec::new();
            File::open(path)
                .and_then(|mut f| f.read_to_end(&mut buf))
                .map_err(|source| StorageError::Io { path: path.to_path_buf(), source })?;
            zip.write_all(&buf).map_err(|source| StorageError::Io {
                path: dest_archive_path.to_path_buf(),
                source,
            })?;
        }
    }

    zip.finish().map_err(|source| zip_err(dest_archive_path, source))?;
    Ok(())
}

/// Restores a notebook archive under `library_root`, extracting into a
/// freshly deduped destination folder (see this module's doc comment for
/// why this never overwrites an existing notebook). Returns the restored
/// `Notebook`, whose `path` points at the new destination folder — the
/// caller is responsible for (re)initializing the notebook's derived index
/// afterward, same as `create_notebook`.
pub fn restore_notebook_archive(
    library_root: &Path,
    archive_path: &Path,
) -> Result<Notebook, StorageError> {
    let file = File::open(archive_path)
        .map_err(|source| StorageError::Io { path: archive_path.to_path_buf(), source })?;
    let mut archive = ZipArchive::new(file).map_err(|source| zip_err(archive_path, source))?;

    std::fs::create_dir_all(library_root)
        .map_err(|source| StorageError::Io { path: library_root.to_path_buf(), source })?;

    // Extract into a staging folder first, so a mid-extraction failure never
    // leaves a half-written folder sitting under a name a later
    // `list_notebooks` scan would pick up.
    let staging_dir = library_root.join(format!(".renote-restore-staging-{}", util::new_id()));
    let extraction = extract_archive(&mut archive, archive_path, &staging_dir);
    if extraction.is_err() {
        let _ = std::fs::remove_dir_all(&staging_dir);
    }
    extraction?;

    let marker_path = staging_dir.join(NOTEBOOK_MARKER_FILE);
    let mut notebook: Notebook = match json_io::read_json(&marker_path) {
        Ok(notebook) => notebook,
        Err(_) => {
            let _ = std::fs::remove_dir_all(&staging_dir);
            return Err(StorageError::InvalidBackupArchive {
                path: archive_path.to_path_buf(),
                reason: format!(
                    "missing or unreadable {NOTEBOOK_MARKER_FILE} — not a reNote notebook backup"
                ),
            });
        }
    };

    let dir_name = util::unique_dir_name(library_root, &notebook.name);
    let dest_dir = library_root.join(&dir_name);
    std::fs::rename(&staging_dir, &dest_dir)
        .map_err(|source| StorageError::Io { path: staging_dir.clone(), source })?;

    // The marker's embedded `path` may point at wherever the notebook lived
    // when it was backed up (a different machine/location); rewrite it to
    // the actual restored location so it stays consistent with reality, the
    // same invariant `create_notebook` establishes for a fresh notebook.
    notebook.path = util::canonical_path_string(&dest_dir)?;
    json_io::write_json(&dest_dir.join(NOTEBOOK_MARKER_FILE), &notebook)?;

    Ok(notebook)
}

fn extract_archive(
    archive: &mut ZipArchive<File>,
    archive_path: &Path,
    staging_dir: &Path,
) -> Result<(), StorageError> {
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|source| zip_err(archive_path, source))?;
        // `enclosed_name()` rejects absolute paths and `..` components —
        // the standard zip-slip guard against an archive extracting outside
        // its destination root.
        let Some(enclosed) = entry.enclosed_name() else {
            return Err(StorageError::InvalidBackupArchive {
                path: archive_path.to_path_buf(),
                reason: format!("archive entry {:?} has an unsafe path", entry.name()),
            });
        };
        let dest: PathBuf = staging_dir.join(enclosed);

        if entry.is_dir() {
            std::fs::create_dir_all(&dest)
                .map_err(|source| StorageError::Io { path: dest, source })?;
            continue;
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|source| StorageError::Io { path: parent.to_path_buf(), source })?;
        }
        let mut buf = Vec::new();
        entry
            .read_to_end(&mut buf)
            .map_err(|source| StorageError::Io { path: dest.clone(), source })?;
        std::fs::write(&dest, &buf).map_err(|source| StorageError::Io { path: dest, source })?;
    }
    Ok(())
}
