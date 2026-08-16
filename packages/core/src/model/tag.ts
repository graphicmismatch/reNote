import type { TagId } from "./ids.js";

/** Built-in tag kinds mirroring OneNote's default tag set; custom tags use "custom". */
export type TagKind = "to-do" | "important" | "question" | "idea" | "definition" | "custom";

export interface Tag {
  readonly id: TagId;
  kind: TagKind;
  label: string;
  color: string;
  /** For "to-do" tags: whether the checkbox is checked. Ignored for other kinds. */
  checked?: boolean;
}
