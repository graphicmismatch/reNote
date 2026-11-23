/**
 * Request for `update_tag`. Only `label`/`color` are updatable — `kind`
 * and the tag's id are fixed at creation (see `renote_storage::tag::update_tag`).
 */
export type UpdateTagRequestDto = { notebookId: string; tagId: string; label: string; color: string };
