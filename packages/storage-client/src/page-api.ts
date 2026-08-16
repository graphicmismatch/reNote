import { invoke } from "@tauri-apps/api/core";
import type {
  CreatePageRequestDto,
  ListPagesRequestDto,
  LoadPageObjectsRequestDto,
  MovePageRequestDto,
  PageDocumentDto,
  PageDto,
  RenamePageRequestDto,
  ReorderPagesRequestDto,
  SavePageObjectsRequestDto,
  SetPageParentRequestDto,
  UpdatePageBackgroundRequestDto,
} from "./types.js";

export function listPages(request: ListPagesRequestDto): Promise<PageDto[]> {
  return invoke("list_pages", { request });
}

export function createPage(request: CreatePageRequestDto): Promise<PageDto> {
  return invoke("create_page", { request });
}

/**
 * Loads a page's full document — metadata plus its ordered object list —
 * in one round trip (renamed from the placeholder `loadPageObjects` shape,
 * which returned a bare object array with no page metadata alongside it).
 */
export function loadPageDocument(request: LoadPageObjectsRequestDto): Promise<PageDocumentDto> {
  return invoke("load_page_objects", { request });
}

/** Overwrites a page's full object list, returning its updated metadata. */
export function savePageObjects(request: SavePageObjectsRequestDto): Promise<PageDto> {
  return invoke("save_page_objects", { request });
}

/** Updates only a page's background (paper color / rule-line style), leaving its objects
 *  untouched, returning its updated metadata. */
export function updatePageBackground(request: UpdatePageBackgroundRequestDto): Promise<PageDto> {
  return invoke("update_page_background", { request });
}

/** Moves a page into another section — possibly in another notebook — keeping its id, its
 *  objects and its assets. Returns the moved page's updated metadata. */
export function movePage(request: MovePageRequestDto): Promise<PageDto> {
  return invoke("move_page", { request });
}

/** Renumbers a section's pages into the given order, returning them in that order. */
export function reorderPages(request: ReorderPagesRequestDto): Promise<PageDto[]> {
  return invoke("reorder_pages", { request });
}

/** Renames a page (updates its title only), returning its updated metadata. */
export function renamePage(request: RenamePageRequestDto): Promise<PageDto> {
  return invoke("rename_page", { request });
}

/** Sets a page's `parentPageId` — `null` un-indents it to top-level (Phase 11.4 indent/outdent).
 *  Never moves the page between sections; returns its updated metadata. */
export function setPageParent(request: SetPageParentRequestDto): Promise<PageDto> {
  return invoke("set_page_parent", { request });
}
