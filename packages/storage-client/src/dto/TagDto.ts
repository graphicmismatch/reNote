import type { TagKindDto } from "./TagKindDto";

/**
 * Mirrors `renote_storage::Tag` / `packages/core/src/model/tag.ts`'s `Tag`,
 * with `notebook_id` stamped on (the storage-side `Tag` doesn't carry one —
 * it's implicit in which notebook's `tags.json` it lives in — but the
 * frontend, which juggles tags across UI state, benefits from having it
 * explicit on the wire, matching how every other *Dto already carries its
 * owning notebook/section id).
 */
export type TagDto = { id: string; notebookId: string; kind: TagKindDto; label: string; color: string };
