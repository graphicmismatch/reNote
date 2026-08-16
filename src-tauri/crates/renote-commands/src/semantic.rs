//! Phase 13's local semantic layer, command surface half: `find_related_pages` reads a page's
//! own already-computed embedding vector (see `renote_index::semantic` — no re-embedding here)
//! and resolves its nearest neighbours to full `SearchHitDto`s. Mirrors `crate::link`'s
//! `list_backlinks` shape: same `page_location` + `read_page` resolution loop, same "an index
//! that briefly lags reality is skipped, not a hard error" posture.

use std::path::{Path, PathBuf};

use tauri::Runtime;

use crate::dto::{FindRelatedPagesRequestDto, SearchHitDto};
use crate::library;

#[tauri::command]
pub fn find_related_pages<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: FindRelatedPagesRequestDto,
) -> Result<Vec<SearchHitDto>, String> {
    let (notebook, _section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let notebook_dir = Path::new(&notebook.path);

    let conn =
        renote_index::open_or_rebuild(notebook_dir, &notebook.id).map_err(|err| err.to_string())?;
    let Some(query_vector) =
        renote_index::page_vector(&conn, &request.page_id).map_err(|err| err.to_string())?
    else {
        // No stored vector for this page yet (e.g. a page created and saved in the same instant
        // this command was called, before its own `index_page` ran) — no related pages rather
        // than an error, matching `list_backlinks`' "index briefly lags" posture.
        return Ok(Vec::new());
    };

    let hits =
        renote_index::nearest(&conn, &query_vector, Some(&request.page_id), request.limit as usize)
            .map_err(|err| err.to_string())?;

    let mut results = Vec::with_capacity(hits.len());
    for hit in hits {
        let Some((section_id, section_dir)) =
            renote_index::page_location(&conn, &hit.page_id).map_err(|err| err.to_string())?
        else {
            continue;
        };
        let doc = renote_storage::read_page(&PathBuf::from(&section_dir), &hit.page_id)
            .map_err(|err| err.to_string())?;
        results.push(SearchHitDto {
            page_id: hit.page_id,
            notebook_id: notebook.id.clone(),
            section_id,
            snippet: doc.page.title.clone(),
            title: doc.page.title,
            score: hit.score as f64,
        });
    }
    Ok(results)
}
