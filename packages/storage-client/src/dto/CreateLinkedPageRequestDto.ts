/**
 * Request for `create_linked_page`: auto-creates a new, empty page titled `title` in
 * `section_id` — the "no existing page with this title" path `resolve_wikilink_target`'s
 * `NotFound` result leads to. Deliberately carries no `orderKey`/`background`/`templateId`
 * (unlike `CreatePageRequestDto`): an auto-created linked page always gets a fresh
 * end-of-section order key and an empty default background, generated server-side (see
 * `crate::link::create_linked_page`), since there's no user-facing "new page" form driving this
 * creation for the frontend to have already collected those from.
 */
export type CreateLinkedPageRequestDto = { notebookId: string; sectionId: string; title: string };
