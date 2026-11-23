import type { PageRuleLinesDto } from "./PageRuleLinesDto";

/**
 * Mirrors `renote_storage::PageBackground` / `packages/core/src/model/page.ts`'s
 * `PageBackground`.
 */
export type PageBackgroundDto = { color: string | null; ruleLines: PageRuleLinesDto };
