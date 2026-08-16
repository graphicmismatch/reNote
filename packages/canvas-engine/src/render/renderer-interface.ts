import type { PageBackground, PageObject } from "@renote/core";
import type { ObjectTypeRegistry } from "../objects/registry.js";

/**
 * The engine's only view of "how things get drawn." PixiRenderer is the real
 * WebGL implementation; NullRenderer lets the scene graph, tools, hit-testing,
 * and undo/redo run under vitest in Node with no GPU or WebView at all.
 */
export interface RendererInterface {
  /** objectTypes is handed over at mount time so PageEngine stays the single owner of the registry. */
  mount(container: HTMLElement, objectTypes: ObjectTypeRegistry): void;
  /**
   * The actual element pointer/wheel input should be scoped to — for `PixiRenderer`, the real
   * `<canvas>` element, deliberately NOT the wrapping `container` `mount()` was given. `container`
   * also holds the text-edit DOM overlay and its floating toolbar (see `PageEditorView.tsx`),
   * appended as siblings of the canvas; scoping `PointerInputDispatcher` to `container` itself —
   * an ancestor of both — meant a `pointerdown` that correctly landed on a toolbar button also
   * bubbled up through `container` and fired the dispatcher's own canvas-input handling for the
   * exact same click, since `addEventListener` fires for events bubbling from any descendant, not
   * just ones whose target is the listened-on element itself. That let clicks meant only for the
   * toolbar also reach whichever tool was active underneath (e.g. re-triggering the Text Box
   * tool's placement gesture at that point). Scoping to the canvas — a leaf element nothing can
   * ever bubble into from a DOM-overlay sibling — fixes that at the source. Only valid to call
   * after `mount()`.
   */
  getInteractionElement(): HTMLElement;
  resize(width: number, height: number): void;
  setCamera(x: number, y: number, zoom: number): void;
  syncObject(object: PageObject): void;
  removeObject(objectId: string): void;
  /**
   * Paper color + rule lines for the current page. `background.color` is a document
   * property (see `Page.background` in `@renote/core`), not a chrome-theme concern — it
   * must render identically regardless of light/dark chrome, which is the whole point:
   * a page's paper color and ink stay visible/readable no matter what theme the app
   * chrome is in.
   */
  setBackground(background: PageBackground): void;
  dispose(): void;
}
