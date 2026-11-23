/**
 * Request for `delete_page_asset`.
 */
export type DeletePageAssetRequestDto = {
  notebookId: string;
  sectionId: string;
  pageId: string;
  assetPath: string;
};
