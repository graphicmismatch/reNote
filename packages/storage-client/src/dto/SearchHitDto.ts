/**
 * Mirrors `packages/core/src/search/query.ts`'s `SearchHit`.
 */
export type SearchHitDto = {
  pageId: string;
  notebookId: string;
  sectionId: string;
  title: string;
  snippet: string;
  score: number;
};
