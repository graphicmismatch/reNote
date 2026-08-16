import type { PageObjectId } from "../model/ids.js";
import type { Bounds, Transform2D } from "./transform.js";

/**
 * The common shape every item placed on a page's infinite canvas shares —
 * text box, ink stroke, image, shape, table, file attachment, audio clip,
 * and any future type registered by the canvas-engine's object-type registry.
 *
 * This envelope carries no rendering or behavior; it's the shared vocabulary
 * between the canvas engine, page-JSON serialization, and PDF export.
 */
export interface PageObject<TType extends string = string, TData = unknown> {
  readonly id: PageObjectId;
  readonly type: TType;
  transform: Transform2D;
  bounds: Bounds;
  data: TData;
}
