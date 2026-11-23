/**
 * One graph-view edge: mirrors `renote_index`'s `(source_page_id, target_page_id)` pair
 * verbatim. `sourcePageId == targetPageId` is a valid self-link edge, not filtered out.
 */
export type PageLinkDto = { sourcePageId: string; targetPageId: string };
