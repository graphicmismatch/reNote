//! The `search` command: fans a query out across every notebook's index
//! under the library root (or just the notebooks named in
//! `query.notebookIds`, if given) and merges/ranks the results. Each
//! notebook's index is its own SQLite file (see `renote_index`), so a
//! cross-notebook search is inherently a fan-out at this layer rather than
//! something a single index query can do.

use std::path::PathBuf;
use std::time::Instant;

use tauri::Runtime;

use crate::dto::{SearchHitDto, SearchQueryDto, SearchResultsDto};
use crate::library;

#[tauri::command]
pub fn search<R: Runtime>(
    app: tauri::AppHandle<R>,
    query: SearchQueryDto,
) -> Result<SearchResultsDto, String> {
    let started_at = Instant::now();

    let root = library::default_library_root(&app)?;
    let all_notebooks = renote_storage::list_notebooks(&root).map_err(|err| err.to_string())?;

    let target_notebooks: Vec<_> = match &query.notebook_ids {
        Some(ids) if !ids.is_empty() => {
            all_notebooks.into_iter().filter(|n| ids.contains(&n.id)).collect()
        }
        _ => all_notebooks,
    };

    let section_ids = query.section_ids.clone();
    let tag_ids = query.tag_ids.clone();
    let filter = renote_index::SearchFilter {
        section_ids: section_ids.as_deref(),
        tag_ids: tag_ids.as_deref(),
        modified_after: query.modified_after.as_deref(),
        modified_before: query.modified_before.as_deref(),
        limit: 50,
    };

    let mut hits: Vec<SearchHitDto> = Vec::new();
    for notebook in &target_notebooks {
        let notebook_dir = PathBuf::from(&notebook.path);
        let conn = renote_index::open_or_rebuild(&notebook_dir, &notebook.id)
            .map_err(|err| err.to_string())?;
        let notebook_hits =
            renote_index::search(&conn, &query.text, &filter).map_err(|err| err.to_string())?;
        hits.extend(notebook_hits.into_iter().map(SearchHitDto::from));
    }

    // Lexical hits only, scored by FTS5 bm25 — sorted and settled before any semantic fallback
    // hits are appended below, since bm25 and cosine similarity are not on the same scale (see
    // the plan's Appendix C). This sort must stay scoped to exactly this group.
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Semantic fallback (Phase 13): FTS5 returning almost nothing usually means the query used
    // different words than the note did, not that nothing relevant exists — embed the query once
    // and append deduped nearest-neighbour hits after all lexical ones. Skipped for an empty
    // query text (the "browse by tag" zero-free-text path above has nothing to embed) and once
    // lexical search already found enough.
    const SEMANTIC_FALLBACK_THRESHOLD: usize = 5;
    if hits.len() < SEMANTIC_FALLBACK_THRESHOLD && !query.text.trim().is_empty() {
        let query_vector = renote_index::embed(&query.text);
        let mut already_hit: std::collections::HashSet<String> =
            hits.iter().map(|hit| hit.page_id.clone()).collect();

        for notebook in &target_notebooks {
            let notebook_dir = PathBuf::from(&notebook.path);
            let conn = renote_index::open_or_rebuild(&notebook_dir, &notebook.id)
                .map_err(|err| err.to_string())?;
            let semantic_hits =
                renote_index::nearest(&conn, &query_vector, None, SEMANTIC_FALLBACK_THRESHOLD)
                    .map_err(|err| err.to_string())?;
            for hit in semantic_hits {
                if !already_hit.insert(hit.page_id.clone()) {
                    continue;
                }
                let Some((section_id, section_dir)) =
                    renote_index::page_location(&conn, &hit.page_id)
                        .map_err(|err| err.to_string())?
                else {
                    continue;
                };
                let doc = renote_storage::read_page(&PathBuf::from(&section_dir), &hit.page_id)
                    .map_err(|err| err.to_string())?;
                hits.push(SearchHitDto {
                    page_id: hit.page_id,
                    notebook_id: notebook.id.clone(),
                    section_id,
                    snippet: doc.page.title.clone(),
                    title: doc.page.title,
                    score: hit.score as f64,
                });
            }
        }
    }

    let took_ms = started_at.elapsed().as_secs_f64() * 1000.0;
    Ok(SearchResultsDto { query, hits, took_ms })
}
