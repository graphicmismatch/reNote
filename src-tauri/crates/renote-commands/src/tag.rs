//! Tag commands: thin wrappers delegating to `renote_storage::tag`, keeping
//! the index's `tag`/`paragraph_tag` tables in sync as a side effect —
//! mirrors `notebook.rs`'s "keep the derived index initialized" shape.

use std::path::Path;

use tauri::Runtime;

use crate::dto::{
    CreateTagRequestDto, DeleteTagRequestDto, ListTaggedParagraphsRequestDto, ListTagsRequestDto,
    TagDto, TaggedParagraphDto, UpdateTagRequestDto,
};
use crate::library;

#[tauri::command]
pub fn list_tags<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ListTagsRequestDto,
) -> Result<Vec<TagDto>, String> {
    let notebook = library::find_notebook(&app, &request.notebook_id)?;
    let notebook_dir = Path::new(&notebook.path);
    let tags = renote_storage::list_tags(notebook_dir).map_err(|err| err.to_string())?;
    Ok(tags.into_iter().map(|tag| TagDto::from_tag(tag, &notebook.id)).collect())
}

#[tauri::command]
pub fn create_tag<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: CreateTagRequestDto,
) -> Result<TagDto, String> {
    let notebook = library::find_notebook(&app, &request.notebook_id)?;
    let notebook_dir = Path::new(&notebook.path);

    let tag = renote_storage::create_tag(
        notebook_dir,
        request.kind.into(),
        &request.label,
        &request.color,
    )
    .map_err(|err| err.to_string())?;

    resync_tag_definitions(notebook_dir, &notebook.id)?;

    Ok(TagDto::from_tag(tag, &notebook.id))
}

#[tauri::command]
pub fn update_tag<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: UpdateTagRequestDto,
) -> Result<TagDto, String> {
    let notebook = library::find_notebook(&app, &request.notebook_id)?;
    let notebook_dir = Path::new(&notebook.path);

    let tag =
        renote_storage::update_tag(notebook_dir, &request.tag_id, &request.label, &request.color)
            .map_err(|err| err.to_string())?;

    resync_tag_definitions(notebook_dir, &notebook.id)?;

    Ok(TagDto::from_tag(tag, &notebook.id))
}

#[tauri::command]
pub fn delete_tag<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: DeleteTagRequestDto,
) -> Result<(), String> {
    let notebook = library::find_notebook(&app, &request.notebook_id)?;
    let notebook_dir = Path::new(&notebook.path);

    // Cascade-clears the tag id off every paragraph that referenced it, across every
    // section/page in the notebook (see `renote_storage::tag::delete_tag`'s doc comment).
    renote_storage::delete_tag(notebook_dir, &request.tag_id).map_err(|err| err.to_string())?;

    // The cascade above can touch an arbitrary number of pages across the whole notebook, so
    // rather than tracking which pages changed, a full rebuild-from-scan is the simplest way to
    // guarantee `paragraph_tag`/`page_fts`/`tag` all stay consistent with what's now on disk —
    // matching this crate's existing "the index is cheap to fully regenerate" posture.
    let conn =
        renote_index::open_or_rebuild(notebook_dir, &notebook.id).map_err(|err| err.to_string())?;
    renote_index::rebuild_from_scan(&conn, notebook_dir, &notebook.id)
        .map_err(|err| err.to_string())?;

    Ok(())
}

/// Every paragraph across the notebook currently tagged with `request.tag_id` (Phase 11.3 to-do
/// rollup) — what a tag panel lists for e.g. a "to-do" tag, most-recently-modified page first.
#[tauri::command]
pub fn list_tagged_paragraphs<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ListTaggedParagraphsRequestDto,
) -> Result<Vec<TaggedParagraphDto>, String> {
    let notebook = library::find_notebook(&app, &request.notebook_id)?;
    let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    let rows = renote_index::list_tagged_paragraphs(&conn, &notebook.id, &request.tag_id)
        .map_err(|err| err.to_string())?;
    Ok(rows.into_iter().map(TaggedParagraphDto::from).collect())
}

/// Re-populates the `tag` table's rows for one notebook from its current
/// `tags.json` — used by `create_tag`/`update_tag`, which only change a
/// tag *definition* (not any paragraph's assignment), so a full
/// `rebuild_from_scan` would be needlessly heavy; `index_tags` alone is
/// the exact write those two commands need to keep the index current.
fn resync_tag_definitions(notebook_dir: &Path, notebook_id: &str) -> Result<(), String> {
    let conn =
        renote_index::open_or_rebuild(notebook_dir, notebook_id).map_err(|err| err.to_string())?;
    let tags = renote_storage::list_tags(notebook_dir).map_err(|err| err.to_string())?;
    renote_index::index_tags(&conn, notebook_id, &tags).map_err(|err| err.to_string())?;
    Ok(())
}
