import { invoke } from "@tauri-apps/api/core";
import type { FindRelatedPagesRequestDto, SearchHitDto } from "./types.js";

/** Phase 13's local semantic layer: the `request.pageId` page's own stored embedding vector's
 *  nearest neighbours, ranked by cosine similarity — "Related Notes" for the open page and
 *  "Find Similar". Reuses `SearchHitDto` (no dedicated response shape), same as `search`. */
export function findRelatedPages(request: FindRelatedPagesRequestDto): Promise<SearchHitDto[]> {
  return invoke("find_related_pages", { request });
}
