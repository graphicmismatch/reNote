/**
 * Request for `list_pages`. Both a notebook and a section id are required:
 * notebook folders are looked up by id under the library root, and a
 * section's on-disk folder is resolved via that notebook's index (see
 * `crate::library::resolve_section_dir`) rather than requiring the caller
 * to track filesystem paths — storage-client has zero filesystem
 * knowledge by design.
 */
export type ListPagesRequestDto = { notebookId: string; sectionId: string };
