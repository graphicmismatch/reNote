import type { PageBackgroundDto } from "./PageBackgroundDto";

/**
 * Request for `create_page`.
 */
export type CreatePageRequestDto = {
  notebookId: string;
  sectionId: string;
  parentPageId: string | null;
  orderKey: string;
  title: string;
  background: PageBackgroundDto;
  templateId: string | null;
};
