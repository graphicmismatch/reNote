import type { NotebookId, SectionGroupId, SectionId } from "./ids.js";

/** A folder that groups sections and/or other section groups. Maps 1:1 to a filesystem directory. */
export interface SectionGroup {
  readonly id: SectionGroupId;
  readonly notebookId: NotebookId;
  readonly parentId: SectionGroupId | null;
  name: string;
  orderKey: string;
}

/** Maps 1:1 to a filesystem directory containing page files. */
export interface Section {
  readonly id: SectionId;
  readonly notebookId: NotebookId;
  readonly parentGroupId: SectionGroupId | null;
  name: string;
  color: string | null;
  orderKey: string;
}
