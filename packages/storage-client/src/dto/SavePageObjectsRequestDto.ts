import type { PageObjectDto } from "./PageObjectDto";

/**
 * Request for `save_page_objects`. Overwrites the page's full object list
 * (matching `renote_storage::write_page`'s replace-not-patch semantics).
 */
export type SavePageObjectsRequestDto = {
  notebookId: string;
  sectionId: string;
  pageId: string;
  objects: Array<PageObjectDto>;
  /**
   * The page's `modifiedAt` as the caller last saw it. If it doesn't match
   * what's on disk, something outside this app (a sync client, a text
   * editor, another window) rewrote the page since, and the save is
   * rejected instead of clobbering it — see `page::save_page_objects`.
   * `None` skips the check, which is what `restore_autosave` and a
   * user-confirmed force-overwrite pass.
   */
  expectedModifiedAt: string | null;
};
