/**
 * Request for `restore_autosave`. No timestamp field: unlike the old
 * multi-version-history design, a page has at most one autosave, so
 * nothing else is needed to identify it.
 */
export type RestoreAutosaveRequestDto = { notebookId: string; sectionId: string; pageId: string };
