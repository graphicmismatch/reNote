import { Application, Container, Graphics } from "pixi.js";
import type { PageBackground, PageObject } from "@renote/core";
import type { ObjectTypeRegistry } from "../objects/registry.js";
import type { ResolveAssetUrl } from "../objects/object-type-definition.js";
import { chunkKeyFor, chunkOriginFor } from "../scene/spatial-index.js";
import { computeRuleLines, resolvePaperColor } from "./page-background.js";
import type { RendererInterface } from "./renderer-interface.js";

const DEFAULT_BACKGROUND: PageBackground = { color: null, ruleLines: "none" };
const RULE_LINE_COLOR = "#94a3b8";
const RULE_LINE_ALPHA = 0.5;
const DOT_RADIUS = 1;

/**
 * Must match `GridSpatialIndex`'s default cell size (see spatial-index.ts) — both mechanisms
 * bucket world space into the same grid, chunkKeyFor/chunkOriginFor being the shared source of
 * truth for what that grid actually is.
 */
const CELL_SIZE = 1024;

/**
 * The real WebGL renderer. Delegates all per-object-type drawing to the
 * ObjectTypeRegistry's renderer factories instead of switching on type
 * itself, so it never needs to change when a new object type is added.
 */
export class PixiRenderer implements RendererInterface {
  private readonly app = new Application();
  /**
   * Created eagerly (not left to `Application.init()` to create internally) and handed to
   * `init({ canvas: this.canvasElement, ... })` below — `init()` is async, so a canvas Pixi
   * created for itself wouldn't exist in the DOM (or be knowable to a caller) until well after
   * `mount()` returns. `getInteractionElement()` needs to hand back a real, stable element
   * synchronously, immediately after `mount()` — see that method's doc comment on
   * `RendererInterface` for why it must be the canvas specifically, not the wrapping container.
   */
  private readonly canvasElement = document.createElement("canvas");
  private readonly world = new Container();
  /**
   * Rule lines live at the stage level, siblings of `world`, not inside it — `world` is
   * what the camera transform (position/scale) moves, but the ruled-paper look needs
   * lines computed in world space and then drawn directly in screen space (see
   * `computeRuleLines`'s doc comment), so this layer is never itself transformed.
   */
  private readonly backgroundLayer = new Graphics();
  private readonly views = new Map<string, Container>();
  /**
   * Floating-origin rendering (Phase 5.6): rather than parenting every object view directly
   * under `world` with world-space coordinates baked into its Pixi geometry, each view is
   * parented under a small per-chunk `Container` (`chunkContainers`, keyed by `chunkKeyFor`'s
   * grid — the same grid `GridSpatialIndex` buckets objects into). The chunk container's own
   * `.position` carries the (potentially huge) world-space offset — safe, because Pixi composes
   * a Container's position as a CPU-side double-precision matrix multiply, not something written
   * into a float32 vertex buffer — while each object type's draw function (see e.g.
   * ink-stroke-object-type.ts's `drawStroke`) only ever draws small, chunk-local coordinates
   * (`object.bounds` minus the chunk's origin) into its Graphics' vertex buffer, which IS
   * float32 and IS where precision would otherwise degrade at extreme world-space magnitudes.
   *
   * Spike note: this (per-chunk Container nesting) is the well-understood, lower-risk half of
   * the floating-origin approach. Whether it alone is sufficient to eliminate float32 jitter at
   * extreme offsets, or whether the camera's own reference frame (`world.position`/`setCamera`)
   * also needs periodic re-anchoring, is empirically uncertain and untested against a real GPU
   * at extreme magnitudes as of this writing. If a real-world jitter report at large coordinates
   * shows this alone isn't enough, camera re-anchoring is the next thing to try.
   */
  private readonly chunkContainers = new Map<string, Container>();
  /** Object id -> the chunk key its view currently lives under, so removeObject/re-chunking
   *  on move know which chunk container to pull the view out of without a linear scan. */
  private readonly viewChunkKeys = new Map<string, string>();
  private ready: Promise<void> | null = null;
  private objectTypes: ObjectTypeRegistry | null = null;
  private disposed = false;

  private currentWidth = 0;
  private currentHeight = 0;
  private currentCamera = { x: 0, y: 0, zoom: 1 };
  private currentBackground: PageBackground = DEFAULT_BACKGROUND;

  /**
   * Optional — see `ResolveAssetUrl`'s doc comment for the full design. Threaded straight
   * through to every `createView`/`updateView` call in `syncObject` below; `apps/desktop`
   * supplies the real implementation (`StorageClient.resolveAssetPath`), `NullRenderer` and any
   * test that doesn't pass one simply gets object types that stay placeholder-shaped for
   * asset-backed types like "image".
   */
  constructor(private readonly resolveAssetUrl?: ResolveAssetUrl) {}

  mount(container: HTMLElement, objectTypes: ObjectTypeRegistry): void {
    this.objectTypes = objectTypes;
    this.currentWidth = container.clientWidth;
    this.currentHeight = container.clientHeight;
    // Appended synchronously, before `init()` resolves — `getInteractionElement()` must be able
    // to return a real, attached element the moment `mount()` returns, not only after the async
    // init below settles (see `canvasElement`'s own doc comment).
    container.appendChild(this.canvasElement);
    this.ready = this.app
      .init({
        canvas: this.canvasElement,
        resizeTo: container,
        backgroundColor: resolvePaperColor(this.currentBackground.color),
        backgroundAlpha: 1,
        antialias: true,
        // Without this, `resolution` defaults to 1 (device-independent px), not
        // `devicePixelRatio` — on any HiDPI/Retina display that renders the whole canvas,
        // including every `HTMLText` glyph texture (which auto-inherits `renderer.resolution`
        // when its own `resolution` option is unset), at sub-native resolution, i.e. blurry.
        // `autoDensity` keeps the canvas's CSS size matching `resizeTo`'s layout size once the
        // backing store's pixel size is scaled up by `resolution`.
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      })
      .then(() => {
        // dispose() can run before init() resolves (e.g. React StrictMode's dev-mode
        // mount->unmount->remount cycle) — skip mounting into a container we've already
        // been told to tear down.
        if (this.disposed) return;
        this.app.stage.addChild(this.backgroundLayer);
        this.app.stage.addChild(this.world);
        // setBackground() may have already been called with the page's real background
        // (e.g. PageEditorView calling it as soon as loadPageDocument resolves) before
        // this async init() settled — the init() options above only capture whatever
        // currentBackground was at mount() time (still the class default), so the real
        // color needs to be (re-)applied now that app.renderer actually exists.
        this.applyBackgroundColor();
        this.redrawBackground();
      });
  }

  getInteractionElement(): HTMLElement {
    return this.canvasElement;
  }

  resize(width: number, height: number): void {
    this.currentWidth = width;
    this.currentHeight = height;
    this.app.renderer?.resize(width, height);
    this.redrawBackground();
  }

  setCamera(x: number, y: number, zoom: number): void {
    this.currentCamera = { x, y, zoom };
    this.world.position.set(-x * zoom, -y * zoom);
    this.world.scale.set(zoom);
    this.redrawBackground();
  }

  setBackground(background: PageBackground): void {
    this.currentBackground = background;
    // Paper color fills the whole viewport regardless of camera — it's the renderer's
    // own background, not a world-space object — so it's applied independently of
    // redrawBackground()'s rule-line drawing.
    this.applyBackgroundColor();
    this.redrawBackground();
  }

  /** No-op until `app.renderer` exists — mount()'s `.then()` re-applies this once it does,
   *  since this can be (and typically is) called before that async init() settles. */
  private applyBackgroundColor(): void {
    if (!this.app.renderer) return;
    this.app.renderer.background.color = resolvePaperColor(this.currentBackground.color);
  }

  private redrawBackground(): void {
    if (!this.app.renderer) return; // not ready yet; mount()'s `.then()` calls this once it is.
    this.backgroundLayer.clear();
    const segments = computeRuleLines(
      this.currentBackground.ruleLines,
      this.currentCamera,
      this.currentWidth,
      this.currentHeight,
    );
    for (const segment of segments) {
      if (segment.kind === "line") {
        this.backgroundLayer
          .moveTo(segment.x1, segment.y1)
          .lineTo(segment.x2, segment.y2)
          .stroke({ width: 1, color: RULE_LINE_COLOR, alpha: RULE_LINE_ALPHA });
      } else {
        this.backgroundLayer.circle(segment.x, segment.y, DOT_RADIUS).fill({
          color: RULE_LINE_COLOR,
          alpha: RULE_LINE_ALPHA,
        });
      }
    }
  }

  syncObject(object: PageObject): void {
    if (!this.objectTypes) {
      throw new Error("PixiRenderer.syncObject called before mount().");
    }
    const definition = this.objectTypes.get(object.type);
    const chunkKey = chunkKeyFor(object.bounds.x, object.bounds.y, CELL_SIZE);
    const origin = chunkOriginFor(chunkKey, CELL_SIZE);
    const previousChunkKey = this.viewChunkKeys.get(object.id);

    let view = this.views.get(object.id);
    if (!view) {
      view = definition.createView(object, origin, this.resolveAssetUrl);
      this.views.set(object.id, view);
      this.getOrCreateChunkContainer(chunkKey).addChild(view);
    } else if (previousChunkKey !== chunkKey) {
      // Object moved across a chunk boundary since its last sync — reparent its view into the
      // new chunk container. `Container.addChild` on a view that already has a parent removes
      // it from that parent first, so this is safe to call without an explicit removeChild.
      this.getOrCreateChunkContainer(chunkKey).addChild(view);
      if (previousChunkKey) this.pruneChunkIfEmpty(previousChunkKey);
    }

    definition.updateView(view, object, origin, this.resolveAssetUrl);
    // Every object type's createView/updateView draws chunk-local geometry (object.bounds -
    // origin — see ChunkOrigin's doc comment), so pivoting/positioning the view around the
    // object's own bounds-center (also expressed in that same chunk-local space) makes
    // view.rotation/view.scale turn and grow the object around its true visual center, matching
    // SceneGraph.hitTestPoint's inverse-transform pivot exactly. Without this, Pixi would
    // rotate/scale around the chunk container's origin instead — an arbitrary point far from the
    // object, not its center.
    const centerLocal = {
      x: object.bounds.x + object.bounds.width / 2 - origin.x,
      y: object.bounds.y + object.bounds.height / 2 - origin.y,
    };
    view.pivot.set(centerLocal.x, centerLocal.y);
    view.position.set(centerLocal.x + object.transform.x, centerLocal.y + object.transform.y);
    view.rotation = object.transform.rotation;
    view.scale.set(object.transform.scaleX, object.transform.scaleY);
    view.zIndex = object.transform.zIndex;
    this.viewChunkKeys.set(object.id, chunkKey);
  }

  removeObject(objectId: string): void {
    const view = this.views.get(objectId);
    if (view) {
      const chunkKey = this.viewChunkKeys.get(objectId);
      const container = chunkKey ? this.chunkContainers.get(chunkKey) : undefined;
      (container ?? this.world).removeChild(view);
      view.destroy({ children: true });
      this.views.delete(objectId);
      this.viewChunkKeys.delete(objectId);
      if (chunkKey) this.pruneChunkIfEmpty(chunkKey);
    }
  }

  /** Looks up (or lazily creates) the `Container` for `chunkKey`, positioned at that chunk's
   *  world-space origin and parented under `world`. */
  private getOrCreateChunkContainer(chunkKey: string): Container {
    let container = this.chunkContainers.get(chunkKey);
    if (!container) {
      container = new Container();
      const origin = chunkOriginFor(chunkKey, CELL_SIZE);
      container.position.set(origin.x, origin.y);
      this.world.addChild(container);
      this.chunkContainers.set(chunkKey, container);
    }
    return container;
  }

  /** Tears down and unparents a chunk container once its last view has been removed/reparented
   *  away, so an emptied region of the canvas doesn't leave an inert Container behind forever. */
  private pruneChunkIfEmpty(chunkKey: string): void {
    const container = this.chunkContainers.get(chunkKey);
    if (!container || container.children.length > 0) return;
    this.world.removeChild(container);
    container.destroy();
    this.chunkContainers.delete(chunkKey);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Give every registered object type a chance to drop any renderer-bound resource it caches
    // outside this renderer's own view tree (currently just "image" — see
    // `ObjectTypeDefinition.onRendererDisposed`'s doc comment for why this matters: a cached
    // `Texture`'s GPU data belongs to whichever renderer uploaded it, so it must not outlive
    // that renderer as far as any OTHER still-live renderer instance is concerned). Must run
    // BEFORE `app.destroy()` below actually tears down this renderer's GPU context, though the
    // exact ordering only matters relative to this renderer's own teardown, not to other
    // instances' independent lifecycles.
    if (this.objectTypes) {
      for (const type of this.objectTypes.registeredTypes) {
        this.objectTypes.get(type).onRendererDisposed?.();
      }
    }
    this.views.clear();
    this.chunkContainers.clear();
    this.viewChunkKeys.clear();
    if (!this.ready) return; // mount() was never called; nothing was initialized to tear down.
    // Application.destroy() touches internal state Pixi only finishes setting up once init()
    // resolves (e.g. resize-observer bookkeeping for the `resizeTo` option) — calling it before
    // then throws (`this._cancelResize is not a function`). Defer the actual teardown until
    // init() has settled either way, rather than assuming mount() always has time to finish
    // first — it doesn't, e.g. under React StrictMode's dev-mode mount->unmount->remount cycle.
    this.ready.then(
      () => this.app.destroy(true, { children: true }),
      () => {
        // init() itself failed (e.g. no WebGL/WebGPU context available) — `app.destroy()` has
        // nothing to tear down, but `canvasElement` was still appended synchronously in `mount()`
        // before this failure was known, so it's still sitting in the DOM and needs removing here.
        this.canvasElement.remove();
      },
    );
  }

  /** Resolves once the underlying Pixi Application has finished initializing. */
  whenReady(): Promise<void> {
    return this.ready ?? Promise.resolve();
  }
}
