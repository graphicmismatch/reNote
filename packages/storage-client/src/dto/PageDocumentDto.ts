import type { PageBackgroundDto } from "./PageBackgroundDto";
import type { PageObjectDto } from "./PageObjectDto";

/**
 * Mirrors `renote_storage::page::PageDocument`: a page's full metadata plus
 * its ordered object list, the shape `load_page_objects` returns so the
 * frontend gets page metadata alongside the objects in one round trip.
 */
export type PageDocumentDto = {
  objects: Array<PageObjectDto>;
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
