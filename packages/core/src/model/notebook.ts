import type { NotebookId } from "./ids.js";

export interface Notebook {
  readonly id: NotebookId;
  name: string;
  /** Absolute path to the notebook's root folder on disk. */
  path: string;
  color: string | null;
  createdAt: string;
  modifiedAt: string;
}
