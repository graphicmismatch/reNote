import type { TagKindDto } from "./TagKindDto";

/**
 * Request for `create_tag`.
 */
export type CreateTagRequestDto = { notebookId: string; kind: TagKindDto; label: string; color: string };
