/**
 * Request for `copy_page_asset` — duplicating an existing asset file for a
 * different page, which is what pasting an image (or any other
 * `assetPath`-backed object) onto another page needs. An `assetPath` is
 * relative to its SECTION directory, so a copied object that lands in a
 * different section would otherwise point at a file that isn't there; within
 * one section it would still resolve, but the two pages would then share a
 * single file and deleting either object would break the other.
 *
 * The source triple is spelled out separately from the destination rather
 * than assumed equal: a copy can cross notebooks, not just pages.
 */
export type CopyPageAssetRequestDto = {
  sourceNotebookId: string;
  sourceSectionId: string;
  sourceAssetPath: string;
  notebookId: string;
  sectionId: string;
  pageId: string;
};
