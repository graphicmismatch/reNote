/**
 * Request for `list_backlinks`: every page linking TO `page_id` ("Linked Mentions").
 * `section_id` isn't strictly needed to answer the query (a page id alone is enough once the
 * owning notebook's index is open) but is included for the same reason every other page-scoped
 * request here (e.g. `GetAutosaveStatusRequestDto`) carries it: it doubles as a existence check
 * via `crate::library::resolve_section_dir` and keeps this request shaped like its siblings.
 */
export type ListBacklinksRequestDto = { notebookId: string; sectionId: string; pageId: string };
