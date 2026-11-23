/**
 * Request for `move_page`. The first triple is where the page is now, the
 * `target_*` pair is where it should end up — which may be another notebook
 * entirely. `order_key` is its position among its new siblings; the frontend
 * computes it the same way it does for a newly created page.
 *
 * The page keeps its id, so every wikilink pointing at it keeps resolving
 * (see `resolve_wikilink_target`) — a move is not a delete-and-recreate.
 */
export type MovePageRequestDto = {
  notebookId: string;
  sectionId: string;
  pageId: string;
  targetNotebookId: string;
  targetSectionId: string;
  orderKey: string;
};
