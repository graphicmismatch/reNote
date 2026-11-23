/**
 * Mirrors `renote_storage::Notebook` / `packages/core/src/model/notebook.ts`'s
 * `Notebook`.
 */
export type NotebookDto = {
  id: string;
  name: string;
  path: string;
  color: string | null;
  createdAt: string;
  modifiedAt: string;
};
