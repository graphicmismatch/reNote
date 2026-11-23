/**
 * Request for `resolve_wikilink_target`: look up every page in `notebook_id` whose title
 * exactly matches `title` (case-sensitive — see `crate::link::resolve_wikilink_target`'s doc
 * comment for why case-sensitive exact match is fine for v1).
 */
export type ResolveWikilinkTargetRequestDto = { notebookId: string; title: string };
