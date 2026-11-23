import type { PageBackgroundDto } from "./PageBackgroundDto";

/**
 * Request for `update_page_background`. Reuses the existing `PageBackgroundDto` — see that
 * type above. Deliberately carries no `objects`: this command leaves the page's object list
 * completely untouched (see `page::update_page_background`'s doc comment).
 */
export type UpdatePageBackgroundRequestDto = {
  notebookId: string;
  sectionId: string;
  pageId: string;
  background: PageBackgroundDto;
};
