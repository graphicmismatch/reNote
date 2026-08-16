//! PDF and plain-text export commands: thin wrappers delegating to `renote_export`, writing the
//! resulting bytes to a caller-supplied `destPath`. Neither this module nor `renote_export`
//! picks a filesystem destination on the user's behalf — the frontend resolves `destPath` via a
//! native save-file dialog (`@tauri-apps/plugin-dialog`) first, the same convention
//! `crate::backup::export_notebook_backup` already uses.

use std::path::{Path, PathBuf};

use tauri::Runtime;

use crate::dto::{
    ExportNotebookMarkdownRequestDto, ExportNotebookPdfRequestDto, ExportPageMarkdownRequestDto,
    ExportPagePdfRequestDto, ExportPagePlainTextRequestDto, ExportSectionMarkdownRequestDto,
    ExportSectionPdfRequestDto,
};
use crate::library;

#[tauri::command]
pub fn export_page_pdf<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ExportPagePdfRequestDto,
) -> Result<(), String> {
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let doc =
        renote_storage::read_page(&section_dir, &request.page_id).map_err(|err| err.to_string())?;
    let bytes =
        renote_export::export_page_to_pdf(&doc, &section_dir).map_err(|err| err.to_string())?;
    write_bytes(&request.dest_path, &bytes)
}

#[tauri::command]
pub fn export_section_pdf<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ExportSectionPdfRequestDto,
) -> Result<(), String> {
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let pages = collect_section_pages(&section_dir)?;
    let bytes = renote_export::export_pages_to_pdf(&pages).map_err(|err| err.to_string())?;
    write_bytes(&request.dest_path, &bytes)
}

#[tauri::command]
pub fn export_notebook_pdf<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ExportNotebookPdfRequestDto,
) -> Result<(), String> {
    let notebook = library::find_notebook(&app, &request.notebook_id)?;
    let notebook_dir = Path::new(&notebook.path);
    let pages = collect_notebook_pages(notebook_dir)?;
    let bytes = renote_export::export_pages_to_pdf(&pages).map_err(|err| err.to_string())?;
    write_bytes(&request.dest_path, &bytes)
}

#[tauri::command]
pub fn export_page_plain_text<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ExportPagePlainTextRequestDto,
) -> Result<(), String> {
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let doc =
        renote_storage::read_page(&section_dir, &request.page_id).map_err(|err| err.to_string())?;
    let text = renote_export::export_page_plain_text(&doc);
    write_bytes(&request.dest_path, text.as_bytes())
}

#[tauri::command]
pub fn export_page_markdown<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ExportPageMarkdownRequestDto,
) -> Result<(), String> {
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let doc =
        renote_storage::read_page(&section_dir, &request.page_id).map_err(|err| err.to_string())?;
    let text = renote_export::export_page_markdown(&doc);
    write_bytes(&request.dest_path, text.as_bytes())
}

#[tauri::command]
pub fn export_section_markdown<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ExportSectionMarkdownRequestDto,
) -> Result<(), String> {
    let (_notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let pages: Vec<renote_storage::PageDocument> =
        collect_section_pages(&section_dir)?.into_iter().map(|(doc, _)| doc).collect();
    let text = renote_export::export_pages_to_markdown(&pages);
    write_bytes(&request.dest_path, text.as_bytes())
}

#[tauri::command]
pub fn export_notebook_markdown<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ExportNotebookMarkdownRequestDto,
) -> Result<(), String> {
    let notebook = library::find_notebook(&app, &request.notebook_id)?;
    let notebook_dir = Path::new(&notebook.path);
    let pages: Vec<renote_storage::PageDocument> =
        collect_notebook_pages(notebook_dir)?.into_iter().map(|(doc, _)| doc).collect();
    let text = renote_export::export_pages_to_markdown(&pages);
    write_bytes(&request.dest_path, text.as_bytes())
}

fn write_bytes(dest_path: &str, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(dest_path, bytes)
        .map_err(|err| format!("failed to write export to {dest_path}: {err}"))
}

/// Every page directly inside `section_dir`, each paired with `section_dir` itself (the PDF
/// renderer needs it to resolve ink-stroke/image asset paths per page) — the whole section's
/// content, in the section's own page order (`list_pages` already sorts by `orderKey`).
fn collect_section_pages(
    section_dir: &Path,
) -> Result<Vec<(renote_storage::PageDocument, PathBuf)>, String> {
    let mut pages = Vec::new();
    for page_meta in renote_storage::list_pages(section_dir).map_err(|err| err.to_string())? {
        let doc =
            renote_storage::read_page(section_dir, &page_meta.id).map_err(|err| err.to_string())?;
        pages.push((doc, section_dir.to_path_buf()));
    }
    Ok(pages)
}

/// Recursively collects every page in every section directly or indirectly under `dir` (a
/// notebook root or a section-group folder) — same recursive shape as
/// `renote-index/src/rebuild.rs`'s `walk_dir`, adapted to collect page documents instead of
/// indexing them.
fn collect_notebook_pages(
    dir: &Path,
) -> Result<Vec<(renote_storage::PageDocument, PathBuf)>, String> {
    let mut pages = Vec::new();

    for section in renote_storage::list_sections(dir).map_err(|err| err.to_string())? {
        let section_dir = renote_storage::section_dir(dir, &section.id);
        pages.extend(collect_section_pages(&section_dir)?);
    }

    for group in renote_storage::list_section_groups(dir).map_err(|err| err.to_string())? {
        let group_dir = renote_storage::section_group_dir(dir, &group.id);
        pages.extend(collect_notebook_pages(&group_dir)?);
    }

    Ok(pages)
}
