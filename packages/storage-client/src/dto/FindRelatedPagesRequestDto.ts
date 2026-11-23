/**
 * Request for `find_related_pages` (Phase 13's local semantic layer): the page's own stored
 * embedding vector is read back, not recomputed, so this needs the same identifying triple as
 * `ListBacklinksRequestDto` plus how many neighbours to return.
 */
export type FindRelatedPagesRequestDto = {
  notebookId: string;
  sectionId: string;
  pageId: string;
  limit: number;
};
