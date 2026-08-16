import { invoke } from "@tauri-apps/api/core";
import type {
  CreateLinkedPageRequestDto,
  ListBacklinksRequestDto,
  ListPageLinksRequestDto,
  PageDto,
  PageLinkDto,
  PageLocationDto,
  ResolveWikilinkTargetRequestDto,
  WikilinkResolutionDto,
} from "./types.js";

/** Every page linking TO `request.pageId` ("Linked Mentions"), resolved to full `PageDto`s. */
export function listBacklinks(request: ListBacklinksRequestDto): Promise<PageDto[]> {
  return invoke("list_backlinks", { request });
}

/** Resolves a typed `[[title` wikilink to a target page within `request.notebookId`. */
export function resolveWikilinkTarget(
  request: ResolveWikilinkTargetRequestDto,
): Promise<WikilinkResolutionDto> {
  return invoke("resolve_wikilink_target", { request });
}

/** Auto-creates a new, empty page titled `request.title` — the "no existing match" path
 *  `resolveWikilinkTarget`'s `notFound` result leads to. */
export function createLinkedPage(request: CreateLinkedPageRequestDto): Promise<PageDto> {
  return invoke("create_linked_page", { request });
}

/** Every `(source, target)` wikilink pair among pages in `request.notebookId` — feeds the graph view. */
export function listPageLinks(request: ListPageLinksRequestDto): Promise<PageLinkDto[]> {
  return invoke("list_page_links", { request });
}

/** Every page in the workspace with its full `Notebook > Section > Page` address — takes no
 *  request, since it deliberately spans every notebook (see the Rust command's doc comment). */
export function listPageLocations(): Promise<PageLocationDto[]> {
  return invoke("list_page_locations");
}
