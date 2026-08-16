import type { PageId, SectionId } from "./ids.js";

export type PageRuleLines = "none" | "college-ruled" | "wide-ruled" | "graph" | "dotted";

export interface PageBackground {
  color: string | null;
  ruleLines: PageRuleLines;
}

export interface Page {
  readonly id: PageId;
  readonly sectionId: SectionId;
  /**
   * Subpages are an ordering/indent relationship among sibling pages within one section,
   * not a filesystem hierarchy — null means top-level within the section.
   */
  parentPageId: PageId | null;
  orderKey: string;
  title: string;
  background: PageBackground;
  templateId: string | null;
  createdAt: string;
  modifiedAt: string;
  /** Schema version of this page's on-disk JSON, for forward migration on read. */
  schemaVersion: number;
}
