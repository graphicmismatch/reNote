/**
 * Request for `save_autosave`. Called on a timer from the frontend, at the
 * interval the user picked in Settings — see `crate::autosave`'s doc
 * comment.
 */
export type SaveAutosaveRequestDto = { notebookId: string; sectionId: string; pageId: string };
