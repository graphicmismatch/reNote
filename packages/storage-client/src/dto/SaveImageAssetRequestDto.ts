/** Request for `saveImageAsset`: `file` is the user-picked image; its pixel size is probed client-side. */
export type SaveImageAssetRequestDto = { notebookId: string; sectionId: string; pageId: string; file: Blob };
