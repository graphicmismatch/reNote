import { EventBus, type Bounds, type PageBackground, type PageObjectId } from "@renote/core";

/**
 * The DOM-overlay seam for rich text editing. `canvas-engine` cannot depend on
 * `@renote/text-editor` (boundary-lint forbids canvas-engine -> sibling-package imports;
 * it may only depend on `@renote/core`), so instead of mounting a `RichTextField` directly,
 * the engine only ever emits these two events. A human wires the actual mount/unmount of
 * `RichTextField` in `apps/desktop` to them:
 *
 * - `"text-edit:begin"` — fired when the user double-clicks a `text-box` object with the
 *   select tool active (see `SelectTool`). Payload carries the object id and its current
 *   page/world-space bounds (`{x,y,width,height}`) so the app can position a DOM overlay
 *   exactly over the "cold" Pixi placeholder. The cold Pixi view is left mounted underneath;
 *   this phase does not hide/dim it on edit-begin, that's an apps/desktop concern.
 * - `"text-edit:end"` — fired when editing should stop: pressing Escape (`SelectTool.onCancel`)
 *   while a text box is being edited, or clicking anywhere else (on empty space or a different
 *   object) while a text box is being edited. Payload carries just the object id that was
 *   being edited, so the app knows which overlay to tear down.
 * - `"camera-changed"` — fired on every `PageEngine.setCamera` call (pan drag, wheel pan,
 *   or zoom). Payload is the new camera. Two consumers need this: a live text-edit overlay
 *   must re-run `cameraToCssTransform` on it or it visibly detaches from its Pixi placeholder
 *   mid-edit (see `PageEditorView.beginTextEdit`), and a minimap must move/resize its viewport
 *   rectangle. Not fired on `resize` — that changes viewport size, not camera position/zoom.
 * - `"background-changed"` — fired on every `PageEngine.setPageBackground` call (initial page
 *   load, and any later edit via the background panel). Payload is the new background. Lets a UI
 *   affordance drawn over the canvas (e.g. the lasso drag path) recompute its contrast color
 *   against the page's own paper color without polling `getPageBackground()` on every frame.
 */
export interface TextEditBeginPayload {
  objectId: PageObjectId;
  worldBounds: Bounds;
  /**
   * The object's rotation, in radians — 0 for the overwhelmingly common unrotated case.
   * `worldBounds` alone (an axis-aligned box) can't tell the app whether the object is actually
   * rotated, so a DOM overlay built from `worldBounds` position/size alone would never rotate to
   * match; this is what lets `PageEditorView`'s overlay positioning apply a matching CSS
   * `rotate(...)`. `boundsCenter(worldBounds)` (see `@renote/core`) is always the correct pivot
   * for that rotation, regardless of the object's own local `bounds`/`transform` — rotating a
   * rectangle around its own center always produces an axis-aligned bounding box centered at
   * that exact same point, so no separate pivot field is needed here.
   */
  rotation: number;
}

/**
 * Payload for `"link-edit:begin"`: which `link-button` object needs a target picked, and where it
 * sits, so the app can position its picker popover over it. Mirrors `TextEditBeginPayload`'s role
 * for text boxes — canvas-engine owns neither the popover nor the page search behind it.
 */
export interface LinkEditBeginPayload {
  objectId: PageObjectId;
  worldBounds: Bounds;
}

export interface TextEditEndPayload {
  objectId: PageObjectId;
}

export interface CameraChangedPayload {
  x: number;
  y: number;
  zoom: number;
}

export interface ViewportChangedPayload {
  width: number;
  height: number;
}

export interface PageEngineEvents extends Record<string, unknown> {
  "text-edit:begin": TextEditBeginPayload;
  "text-edit:end": TextEditEndPayload;
  /** Fired when a `link-button` needs its navigation target picked — on spawn, and again when the
   *  user opens an existing button to re-point it. See `LinkEditBeginPayload`. */
  "link-edit:begin": LinkEditBeginPayload;
  "camera-changed": CameraChangedPayload;
  /** Fired on every `PageEngine.resize` (the container's CSS pixel size changed — e.g. the
   *  window or a sidebar resized). A minimap needs this alongside "camera-changed" to compute
   *  its viewport rectangle, since the rectangle's on-screen size depends on both. */
  "viewport-changed": ViewportChangedPayload;
  "background-changed": PageBackground;
}

export type PageEngineEventBus = EventBus<PageEngineEvents>;
