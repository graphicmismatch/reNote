import type { NotebookId, SectionId, TagId } from "../model/ids.js";

export interface SearchQuery {
  text: string;
  notebookIds?: NotebookId[];
  sectionIds?: SectionId[];
  tagIds?: TagId[];
  modifiedAfter?: string;
  modifiedBefore?: string;
}

export interface SearchHit {
  pageId: string;
  notebookId: NotebookId;
  sectionId: SectionId;
  title: string;
  /** Highlighted plain-text snippet around the match, e.g. from FTS5's snippet(). */
  snippet: string;
  score: number;
}

export interface SearchResults {
  query: SearchQuery;
  hits: SearchHit[];
  tookMs: number;
}
