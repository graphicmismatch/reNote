import type { Page } from "../model/page.js";
import type { PageObject } from "./envelope.js";

/**
 * A page's full wire/on-disk shape: `Page` metadata flattened together with
 * its ordered object list, matching the JSON `renote-storage` reads/writes
 * for `page.json` (and what `renote-commands`' `PageDocumentDto` mirrors via
 * `#[serde(flatten)]`) — `{ id, sectionId, ..., objects: [...] }`, not
 * `{ page: {...}, objects: [...] }`.
 */
export type PageDocument = Page & { objects: PageObject[] };
