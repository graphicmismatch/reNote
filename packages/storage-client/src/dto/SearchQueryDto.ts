/**
 * Mirrors `packages/core/src/search/query.ts`'s `SearchQuery`. `tag_ids`,
 * when non-empty, narrows results to pages carrying a paragraph tagged
 * with one of the given tag ids (see `crate::search`'s use of
 * `renote_index::SearchFilter::tag_ids`).
 */
export type SearchQueryDto = {
  text: string;
  notebookIds: Array<string> | null;
  sectionIds: Array<string> | null;
  tagIds: Array<string> | null;
  modifiedAfter: string | null;
  modifiedBefore: string | null;
};
