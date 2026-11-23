import type { SearchHitDto } from "./SearchHitDto";
import type { SearchQueryDto } from "./SearchQueryDto";

/**
 * Mirrors `packages/core/src/search/query.ts`'s `SearchResults`.
 */
export type SearchResultsDto = { query: SearchQueryDto; hits: Array<SearchHitDto>; tookMs: number };
