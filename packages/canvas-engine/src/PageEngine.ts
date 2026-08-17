import { EventBus, type PageBackground } from "@renote/core";
import {
  applyWheelPan,
  computePannedCamera,
  computeZoomedCamera,
  type PanAnchor,
} from "./camera-gestures.js";
import { ObjectTypeRegistry } from "./objects/registry.js";
import { SceneGraph } from "./scene/scene-graph.js";
import { SelectionManager } from "./selection/selection-manager.js";
import { CommandStack } from "./commands/command-stack.js";
import { ToolRegistry } from "./tools/tool-registry.js";
import { InkSettingsRegistry } from "./tools/ink-settings.js";
import { PointerInputDispatcher } from "./input/pointer-input-dispatcher.js";
import type { PointerSourceOverrides } from "./input/pointer-event.js";
import type { RendererInterface } from "./render/renderer-interface.js";
import type { PageEngineEvents } from "./text-edit-events.js";

/**
 * The sole public entry point of the canvas engine. Everything else in this
 * package (scene graph, registries, renderer, input) is an implementation
 * detail reached only through here — apps/desktop's React wrapper, tests,
 * and any future embed all go through this one facade.
 */
export class PageEngine {
  readonly scene = new SceneGraph();
  readonly objectTypes = new ObjectTypeRegistry();
  readonly tools = new ToolRegistry();
  readonly selection = new SelectionManager();
  readonly commands: CommandStack<SceneGraph>;
  /**
   * Live `{color, width}` per ink-producing/size-bearing tool id (pen, highlighter, shape
   * tools, eraser radii) — see ink-settings.ts. Defaults to a fresh, page-scoped registry so
   * existing call sites (`new PageEngine(renderer)`, this package's own tests) keep working
   * unchanged; `apps/desktop` passes in one shared instance across page switches instead, so
   * the user's chosen pen color survives navigating to a different page (see
   * `PageEditorView`'s doc comment on why the engine itself is recreated per page).
   */
  readonly inkSettings: InkSettingsRegistry;
  /**
   * Manual "treat X input as Y" device-treatment override — see `PointerSourceOverrides`'s
   * doc comment. A mutable object, not a snapshot: `apps/desktop` owns one stable instance
   * (persisted, editable from a Settings dialog) and mutates its fields in place, which
   * `PointerInputDispatcher` reads fresh on every event — this is what lets a settings
   * change apply immediately without recreating the engine. Defaults to `{}` (no overrides)
   * so existing call sites keep working unchanged.
   */
  readonly pointerSourceOverrides: PointerSourceOverrides;
  /**
   * Cross-cutting engine events consumed outside canvas-engine — currently just the
   * text-box DOM-overlay seam ("text-edit:begin"/"text-edit:end", see text-edit-events.ts).
   * Not a general pub/sub bus for every internal change: scene/selection/command-stack
   * changes already have their own dedicated event buses.
   */
  readonly events = new EventBus<PageEngineEvents>();

  private dispatcher: PointerInputDispatcher | null = null;
  private camera = { x: 0, y: 0, zoom: 1 };
  private viewport = { width: 0, height: 0 };
  private background: PageBackground = { color: null, ruleLines: "none" };
  /** Set for the duration of a pan gesture (middle-click or Ctrl+primary-click drag).
   *  Anchored to the screen position and camera at gesture start — see
   *  `computePannedCamera`'s doc comment for why. */
  private panAnchor: PanAnchor | null = null;

  constructor(
    private readonly renderer: RendererInterface,
    inkSettings: InkSettingsRegistry = new InkSettingsRegistry(),
    pointerSourceOverrides: PointerSourceOverrides = {},
  ) {
    this.inkSettings = inkSettings;
    this.pointerSourceOverrides = pointerSourceOverrides;
    this.commands = new CommandStack(this.scene);
    this.scene.events.on("added", (object) => this.renderer.syncObject(object));
    this.scene.events.on("updated", (object) => this.renderer.syncObject(object));
    this.scene.events.on("removed", (id) => this.renderer.removeObject(id));
  }

  mount(container: HTMLElement): void {
    this.renderer.mount(container, this.objectTypes);
    // The renderer's own interaction element (its canvas), NOT `container` — `container` also
    // holds the text-edit DOM overlay/floating toolbar (siblings of the canvas), and scoping
    // pointer input there let clicks meant only for that overlay also bubble into canvas-level
    // tool handling. See `RendererInterface.getInteractionElement`'s doc comment for the full story.
    this.dispatcher = new PointerInputDispatcher(
      this.renderer.getInteractionElement(),
      { screenToWorld: (x, y) => this.screenToWorld(x, y) },
      {
        onDown: (event) => this.tools.active?.onPointerDown(event),
        onMove: (event) => this.tools.active?.onPointerMove(event),
        onUp: (event) => this.tools.active?.onPointerUp(event),
        onPanStart: (event) => this.beginPan(event.screenX, event.screenY),
        onPanMove: (event) => this.continuePan(event.screenX, event.screenY),
        onPanEnd: () => this.endPan(),
        onWheelPan: (deltaX, deltaY) => this.panBy(deltaX, deltaY),
        onWheelZoom: (deltaY, screenX, screenY) => this.zoomBy(deltaY, screenX, screenY),
      },
      window,
      this.pointerSourceOverrides,
    );
  }

  resize(width: number, height: number): void {
    this.viewport = { width, height };
    this.renderer.resize(width, height);
    this.events.emit("viewport-changed", { width, height });
  }

  getViewport(): { width: number; height: number } {
    return { ...this.viewport };
  }

  setCamera(x: number, y: number, zoom: number): void {
    this.camera = { x, y, zoom };
    this.renderer.setCamera(x, y, zoom);
    this.events.emit("camera-changed", { x, y, zoom });
  }

  /** Paper color + rule lines for the current page — see `RendererInterface.setBackground`. */
  setPageBackground(background: PageBackground): void {
    this.background = background;
    this.renderer.setBackground(background);
    this.events.emit("background-changed", background);
  }

  getCamera(): { x: number; y: number; zoom: number } {
    return { ...this.camera };
  }

  /** The current page's paper color + rule lines — defaults to `{ color: null, ruleLines: "none" }`
   *  until `setPageBackground` is first called (e.g. before a page has finished loading). Lets a
   *  UI affordance (e.g. the lasso drag path) contrast itself against the page's own paper color
   *  rather than the app chrome theme — see `resolvePaperColor`'s doc comment on why paper color
   *  is theme-independent — without every consumer having to separately track it via events. */
  getPageBackground(): PageBackground {
    return this.background;
  }

  private screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: this.camera.x + screenX / this.camera.zoom,
      y: this.camera.y + screenY / this.camera.zoom,
    };
  }

  private beginPan(screenX = 0, screenY = 0): void {
    this.panAnchor = { screenX, screenY, cameraX: this.camera.x, cameraY: this.camera.y };
  }

  private continuePan(screenX = 0, screenY = 0): void {
    if (!this.panAnchor) return;
    const next = computePannedCamera(this.panAnchor, screenX, screenY, this.camera.zoom);
    this.setCamera(next.x, next.y, next.zoom);
  }

  private endPan(): void {
    this.panAnchor = null;
  }

  /** Scroll-wheel panning — `dx`/`dy` are screen pixels. */
  private panBy(dx: number, dy: number): void {
    const next = applyWheelPan(this.camera, dx, dy);
    this.setCamera(next.x, next.y, next.zoom);
  }

  /** Ctrl+wheel zoom, anchored to `screenX`/`screenY` — see `computeZoomedCamera`'s doc comment. */
  private zoomBy(deltaY: number, screenX: number, screenY: number): void {
    const next = computeZoomedCamera(this.camera, deltaY, screenX, screenY);
    this.setCamera(next.x, next.y, next.zoom);
  }

  dispose(): void {
    this.dispatcher?.dispose();
    this.dispatcher = null;
    this.renderer.dispose();
  }
}
