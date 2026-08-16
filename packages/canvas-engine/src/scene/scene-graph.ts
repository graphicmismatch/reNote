import {
  boundsCenter,
  EventBus,
  invertTransformPoint,
  transformedBounds,
  type PageObject,
  type PageObjectId,
} from "@renote/core";
import type { ObjectTypeRegistry } from "../objects/registry.js";
import { GridSpatialIndex, type SpatialIndex } from "./spatial-index.js";

export interface SceneGraphEvents extends Record<string, unknown> {
  added: PageObject;
  updated: PageObject;
  removed: PageObjectId;
}

/**
 * Holds the current set of page objects for one page and keeps the spatial
 * index in sync. This is the in-memory model the tools/renderer/undo-redo
 * system all operate on; it holds no rendering or persistence logic itself.
 */
export class SceneGraph {
  readonly events = new EventBus<SceneGraphEvents>();
  private readonly objects = new Map<PageObjectId, PageObject>();

  constructor(readonly spatialIndex: SpatialIndex = new GridSpatialIndex()) {}

  add(object: PageObject): void {
    this.objects.set(object.id, object);
    this.spatialIndex.insert(object.id, transformedBounds(object.bounds, object.transform));
    this.events.emit("added", object);
  }

  update(object: PageObject): void {
    this.objects.set(object.id, object);
    this.spatialIndex.update(object.id, transformedBounds(object.bounds, object.transform));
    this.events.emit("updated", object);
  }

  remove(id: PageObjectId): void {
    this.objects.delete(id);
    this.spatialIndex.remove(id);
    this.events.emit("removed", id);
  }

  /**
   * Removes every object without going through `remove()`'s per-object
   * event emission — used when swapping in a different page's content
   * wholesale (loading a page is not a user edit, so it must not touch
   * the undo/redo command history), not for deleting objects a user
   * selected. Emits one `"removed"` per id removed, same as `remove()`,
   * so renderer sync stays correct; callers that also need to reset undo
   * history for a fresh page should build a new `PageEngine` instead.
   */
  clear(): void {
    const ids = Array.from(this.objects.keys());
    for (const id of ids) {
      this.remove(id);
    }
  }

  get(id: PageObjectId): PageObject | undefined {
    return this.objects.get(id);
  }

  get all(): readonly PageObject[] {
    return Array.from(this.objects.values());
  }

  /**
   * Broad-phase hits from the spatial index (bounds-rect only). Prefer
   * `hitTestPoint` with an `ObjectTypeRegistry` where precise per-type
   * hit-testing matters (e.g. selecting ink strokes by their actual path,
   * not their bounding box) — this overload exists for callers that only
   * need "what's roughly here" (viewport culling, tests) without pulling
   * in the registry.
   */
  hitTestPoint(x: number, y: number): PageObjectId[];
  /**
   * Narrows the spatial index's broad-phase matches using each candidate's
   * registered `ObjectTypeDefinition.hitTest`. A candidate whose type isn't
   * registered in `objectTypes` falls back to the broad-phase (bounds-rect)
   * match rather than being silently dropped.
   *
   * `object.bounds`/`data` describe the object's shape in its own local (pre-transform) space
   * (see `transform.ts`'s doc comment) while `x`/`y` here are a world-space query point, so the
   * point is inverse-transformed into that local space — pivoted at `boundsCenter(object.bounds)`,
   * matching `PixiRenderer.syncObject`'s rendering pivot exactly — before running the existing
   * per-type `hitTest`. Under an identity transform this is a no-op (local === world), so every
   * type's `hitTest` implementation needs no changes.
   */
  hitTestPoint(x: number, y: number, objectTypes: ObjectTypeRegistry): PageObjectId[];
  hitTestPoint(x: number, y: number, objectTypes?: ObjectTypeRegistry): PageObjectId[] {
    const candidates = this.spatialIndex.queryPoint(x, y) as PageObjectId[];
    if (!objectTypes) return candidates;

    return candidates.filter((id) => {
      const object = this.objects.get(id);
      if (!object) return false;
      const localPoint = invertTransformPoint({ x, y }, object.transform, boundsCenter(object.bounds));
      if (!objectTypes.has(object.type)) return true;
      return objectTypes.get(object.type).hitTest(object, localPoint);
    });
  }
}
