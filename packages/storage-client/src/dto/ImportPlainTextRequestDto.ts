/** Request for `importPlainTextFile`: `file` is the user-picked `.txt`/`.md` file. */
export type ImportPlainTextRequestDto = { notebookId: string; sectionId: string; pageId: string; file: Blob };
