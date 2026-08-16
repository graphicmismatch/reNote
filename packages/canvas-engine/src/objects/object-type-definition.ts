import type { Container } from "pixi.js";
import type { PageObject } from "@renote/core";

export interface HitTestPoint {
  x: number;
  y: number;
}

/**
 * World-space origin of the chunk `Container` a view is (or will be) parented under — see
 * `PixiRenderer`'s chunk-container doc comment. `createView`/`updateView` implementations must
 * subtract this from every world-space coordinate they draw, so the resulting geometry is
 * chunk-local (small, float32-precision-safe) rather than world-absolute. `{x: 0, y: 0}` makes
 * chunk-local coordinates equal world coordinates, which is what every existing test that
 * doesn't care about chunking uses.
 */
export interface ChunkOrigin {
  x: number;
  y: number;
}

/**
 * Resolves an object's persisted `assetPath` (relative to its section — meaningless without
 * knowing which section that is) to a URL a Pixi `Texture` can actually load, e.g. via
 * `PIXI.Assets.load(url)`. `canvas-engine` has no filesystem/Tauri access and never will (the
 * package boundary forbids importing `@tauri-apps/*`/`@renote/storage-client` here) — see
 * `image-object-type.ts`'s doc comment for the full design. Concretely: `apps/desktop` builds
 * one of these per mounted page (bound to that page's `notebookId`/`sectionId`) from
 * `StorageClient.resolveAssetPath`, and threads it into `new PixiRenderer(resolveAssetUrl)`;
 * `PixiRenderer.syncObject` passes it straight through to `createView`/`updateView`. Omitted
 * (e.g. `NullRenderer`, or any test that doesn't care) simply means "can't load a real texture
 * here" — every consumer must keep working with it absent, never require it.
 */
export type ResolveAssetUrl = (assetPath: string) => Promise<string>;

/**
 * What a registered object type contributes. Adding a new page-object type
 * (e.g. a future "diagram" object) means writing one of these and registering
 * it — no other module needs to change.
 */
export interface ObjectTypeDefinition<TType extends string = string, TData = unknown> {
  readonly type: TType;
  /** Validates/normalizes a freshly-deserialized data payload; throws on malformed data. */
  validate(data: unknown): TData;
  /**
   * Creates the Pixi display object for a fresh instance of this type. `resolveAssetUrl` is
   * only meaningful to types that load external bytes (currently just "image" — see
   * `ResolveAssetUrl`'s doc comment); every other type's implementation simply has arity 2 and
   * ignores the third argument, which TypeScript allows structurally.
   */
  createView(
    object: PageObject<TType, TData>,
    origin: ChunkOrigin,
    resolveAssetUrl?: ResolveAssetUrl,
  ): Container;
  /** Updates an existing view in place after the object's data/transform changed. */
  updateView(
    view: Container,
    object: PageObject<TType, TData>,
    origin: ChunkOrigin,
    resolveAssetUrl?: ResolveAssetUrl,
  ): void;
  /** Geometric hit-test in the object's local/page space; renderer-agnostic. */
  hitTest(object: PageObject<TType, TData>, point: HitTestPoint): boolean;
  readonly supportsRotation: boolean;
  readonly supportsResize: boolean;
  /**
   * Called once by `PixiRenderer.dispose()`, for every registered type, right before it tears
   * down its `Application`/WebGL context. A type whose `createView`/`updateView` cache any
   * renderer-bound GPU resource across instances (currently just "image" — see
   * `image-object-type.ts`'s texture cache) MUST drop that cache here: a `Texture` object is
   * bound to the `Application`/renderer that uploaded it, and destroying that renderer (via
   * `app.destroy(true, ...)`) invalidates its GPU-side data even though the JS-level `Texture`
   * object itself lingers — a SECOND, still-live `PixiRenderer` instance (e.g. one created by
   * React StrictMode's dev-mode mount→cleanup→remount double-invoke, or simply a later
   * page/view remount) that reused the same cached `Texture` from a module-level `Map` would
   * then render nothing (a GPU-invalidated texture paints as blank) despite every JS-level
   * check saying "already loaded" — this is exactly the bug this hook exists to prevent.
   * Optional: types with no renderer-scoped cache (i.e. every non-asset-backed type today)
   * simply omit it.
   */
  onRendererDisposed?(): void;
}
