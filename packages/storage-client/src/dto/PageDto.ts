import type { PageBackgroundDto } from "./PageBackgroundDto";

/**
 * Mirrors `renote_storage::Page` / `packages/core/src/model/page.ts`'s `Page`.
 */
export type PageDto = {
  id: string;
  sectionId: string;
  parentPageId: string | null;
  orderKey: string;
  title: string;
  background: PageBackgroundDto;
  templateId: string | null;
  createdAt: string;
  modifiedAt: string;
  schemaVersion: number;
};
