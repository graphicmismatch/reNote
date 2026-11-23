/**
 * Mirrors `renote_storage::SectionGroup` / `packages/core/src/model/section.ts`'s
 * `SectionGroup`.
 */
export type SectionGroupDto = {
  id: string;
  notebookId: string;
  parentId: string | null;
  name: string;
  orderKey: string;
};
