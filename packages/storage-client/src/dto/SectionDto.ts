/**
 * Mirrors `renote_storage::Section` / `packages/core/src/model/section.ts`'s `Section`.
 */
export type SectionDto = {
  id: string;
  notebookId: string;
  parentGroupId: string | null;
  name: string;
  color: string | null;
  orderKey: string;
};
