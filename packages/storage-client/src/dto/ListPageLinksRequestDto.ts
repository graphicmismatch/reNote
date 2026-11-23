/**
 * Request for `list_page_links`: every `(source, target)` wikilink pair among pages in
 * `notebook_id` — feeds the graph view.
 */
export type ListPageLinksRequestDto = { notebookId: string };
