/**
 * Request for `reorder_pages`: `page_ids` is the section's pages in the
 * order the user just dragged them into. Every one of them is renumbered,
 * rather than trying to squeeze a new key between two neighbours — order
 * keys are fixed-width (see `AppShell`'s `newOrderKey`), so there is no room
 * between adjacent values, and a section holds tens of pages.
 */
export type ReorderPagesRequestDto = { notebookId: string; sectionId: string; pageIds: Array<string> };
