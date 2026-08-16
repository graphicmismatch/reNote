//! Page-linking + graph-view commands (Phase 7): bidirectional wikilinks and their derived
//! `page_link` index table. Mirrors `crate::tag`'s "thin wrapper delegating to
//! renote_storage/renote_index, keeping the index in sync" shape.

use std::path::{Path, PathBuf};

use tauri::Runtime;

use crate::dto::{
    CreateLinkedPageRequestDto, ListBacklinksRequestDto, ListPageLinksRequestDto, PageDto,
    PageLinkDto, PageLocationDto, ResolveWikilinkTargetRequestDto, WikilinkResolutionDto,
};
use crate::{library, naming};

/// Every page's "Linked Mentions": pages whose content wikilinks to `request.page_id`, resolved
/// to full `PageDto`s (not just ids) so a Backlinks panel can render titles/navigate directly.
/// A page backlinking to itself (a self-link) is resolved and returned like any other backlink.
#[tauri::command]
pub fn list_backlinks<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ListBacklinksRequestDto,
) -> Result<Vec<PageDto>, String> {
    let (notebook, _section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;
    let notebook_dir = Path::new(&notebook.path);

    let conn =
        renote_index::open_or_rebuild(notebook_dir, &notebook.id).map_err(|err| err.to_string())?;
    let source_page_ids =
        renote_index::list_backlinks(&conn, &request.page_id).map_err(|err| err.to_string())?;

    let mut pages = Vec::with_capacity(source_page_ids.len());
    for source_page_id in source_page_ids {
        let Some((_section_id, section_dir)) =
            renote_index::page_location(&conn, &source_page_id).map_err(|err| err.to_string())?
        else {
            // The index has a page_link row for a source page that's no longer indexed (e.g. it
            // was trashed after the linking page's last save but before its own next
            // reindex/rebuild) — skip it rather than error, matching this crate's general
            // "the index can lag briefly, don't let that surface as a hard failure" posture.
            continue;
        };
        let doc = renote_storage::read_page(&PathBuf::from(section_dir), &source_page_id)
            .map_err(|err| err.to_string())?;
        pages.push(PageDto::from(doc.page));
    }
    Ok(pages)
}

/// Recursively collects every `(Page, owning section_dir)` directly or indirectly under `dir` —
/// the same recursive section/section-group walk `renote_index::rebuild_from_scan`'s internal
/// `walk_dir` performs, reimplemented here (rather than shared) because this needs the actual
/// `Page` structs to filter by title, not index rows. Mirrors that function's exact recursion
/// shape and its "only through renote-storage's own public API" discipline.
fn collect_pages(dir: &Path, out: &mut Vec<(renote_storage::Page, PathBuf)>) -> Result<(), String> {
    for section in renote_storage::list_sections(dir).map_err(|err| err.to_string())? {
        let section_dir = renote_storage::section_dir(dir, &section.id);
        for page in renote_storage::list_pages(&section_dir).map_err(|err| err.to_string())? {
            out.push((page, section_dir.clone()));
        }
    }
    for group in renote_storage::list_section_groups(dir).map_err(|err| err.to_string())? {
        let group_dir = renote_storage::section_group_dir(dir, &group.id);
        collect_pages(&group_dir, out)?;
    }
    Ok(())
}

/// Resolves a typed `[[title` wikilink to a target page within `notebook_id` — titles are only
/// unique within one notebook (never enforced cross-notebook), so this never looks outside it.
/// Exact, case-sensitive title match (v1: `"Recipes"` and `"recipes"` are different pages if both
/// exist; a future revision could relax this to case-insensitive, but exact match keeps today's
/// auto-create path unambiguous — every existing page's title is already unique-enough within a
/// notebook for this to behave predictably in practice). Zero matches -> `NotFound` (the frontend
/// should follow up with `create_linked_page`); exactly one -> `Found`; more than one (two pages
/// in the same notebook sharing a title, e.g. one in each of two different sections) ->
/// `Ambiguous`, so the frontend can show a small disambiguation popover instead of guessing. The
/// page currently being edited is never excluded from candidates — linking a page to itself (a
/// self-reference) is a legitimate, supported outcome here, same as any other match.
#[tauri::command]
pub fn resolve_wikilink_target<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ResolveWikilinkTargetRequestDto,
) -> Result<WikilinkResolutionDto, String> {
    let notebook = library::find_notebook(&app, &request.notebook_id)?;
    let notebook_dir = Path::new(&notebook.path).to_path_buf();

    let mut pages: Vec<(renote_storage::Page, PathBuf)> = Vec::new();
    collect_pages(&notebook_dir, &mut pages)?;

    let matches: Vec<PageDto> = pages
        .into_iter()
        .filter(|(page, _dir)| page.title == request.title)
        .map(|(page, _dir)| PageDto::from(page))
        .collect();

    Ok(match matches.len() {
        0 => WikilinkResolutionDto::NotFound,
        1 => {
            let page = matches.into_iter().next().expect("len checked above");
            WikilinkResolutionDto::Found { page: Box::new(page) }
        }
        _ => WikilinkResolutionDto::Ambiguous { pages: matches },
    })
}

/// A sortable, monotonically-increasing order key for an auto-created linked page — the same
/// `Date.now()`-padded-to-20-digits shape `apps/desktop/src/app-shell/AppShell.tsx`'s
/// `newOrderKey()` produces for every other "new item append at the end" creation, generated
/// here instead since `CreateLinkedPageRequestDto` deliberately carries no `orderKey` of its own
/// (see that DTO's doc comment: there's no user-facing "new page" form for the frontend to have
/// already collected one from — auto-creation happens invisibly during wikilink resolution).
fn auto_order_key() -> String {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("{now_ms:020}")
}

/// Auto-creates a new, empty page titled `request.title` in `request.section_id` — the
/// "no existing page with this title" path `resolve_wikilink_target`'s `NotFound` result leads
/// to (Logseq-style auto-create-on-first-reference, per the project plan's Phase 7 design).
/// Delegates to the exact same `renote_storage::create_page` the ordinary `create_page` command
/// uses, with a default empty background and no template, then indexes the new (empty) page the
/// same way `create_page` does.
#[tauri::command]
pub fn create_linked_page<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: CreateLinkedPageRequestDto,
) -> Result<PageDto, String> {
    let (notebook, section_dir) =
        library::resolve_section_dir(&app, &request.notebook_id, &request.section_id)?;

    naming::ensure_page_title_free(&section_dir, &request.title, None)?;

    let page = renote_storage::create_page(
        &section_dir,
        &request.section_id,
        None,
        &auto_order_key(),
        &request.title,
        renote_storage::PageBackground {
            color: None,
            rule_lines: renote_storage::PageRuleLines::None,
        },
        None,
    )
    .map_err(|err| err.to_string())?;

    let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
        .map_err(|err| err.to_string())?;
    renote_index::index_page(&conn, &notebook.id, &page, &[], &section_dir)
        .map_err(|err| err.to_string())?;

    Ok(PageDto::from(page))
}

/// Every page in the whole workspace with its full `Notebook > Section > Page` address — what
/// the frontend's link autocomplete lists a suggestion's location from, and what it resolves an
/// exact `[[!Notebook@Section$Page#Heading` path against. Workspace-wide (not notebook-scoped
/// like `resolve_wikilink_target`) precisely because that syntax exists to link *across*
/// notebooks; a wikilink stores only its target's page id, which is notebook-agnostic.
///
/// One index query per notebook, no page files read — see `renote_index::list_page_locations`.
#[tauri::command]
pub fn list_page_locations<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<PageLocationDto>, String> {
    let root = library::default_library_root(&app)?;
    let notebooks = renote_storage::list_notebooks(&root).map_err(|err| err.to_string())?;

    let mut locations = Vec::new();
    for notebook in notebooks {
        let conn = renote_index::open_or_rebuild(Path::new(&notebook.path), &notebook.id)
            .map_err(|err| err.to_string())?;
        let rows = renote_index::list_page_locations(&conn, &notebook.id)
            .map_err(|err| err.to_string())?;
        locations.extend(rows.into_iter().map(|row| PageLocationDto {
            page_id: row.page_id,
            page_title: row.page_title,
            section_id: row.section_id,
            section_name: row.section_name,
            notebook_id: notebook.id.clone(),
            notebook_name: notebook.name.clone(),
        }));
    }
    Ok(locations)
}

/// Every `(source, target)` wikilink edge among pages in `request.notebook_id` — feeds the graph
/// view (one node per page, one edge per row here, including self-link rows).
#[tauri::command]
pub fn list_page_links<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: ListPageLinksRequestDto,
) -> Result<Vec<PageLinkDto>, String> {
    let notebook = library::find_notebook(&app, &request.notebook_id)?;
    let notebook_dir = Path::new(&notebook.path);

    let conn =
        renote_index::open_or_rebuild(notebook_dir, &notebook.id).map_err(|err| err.to_string())?;
    let pairs =
        renote_index::list_page_links(&conn, &notebook.id).map_err(|err| err.to_string())?;
    Ok(pairs.into_iter().map(PageLinkDto::from).collect())
}
