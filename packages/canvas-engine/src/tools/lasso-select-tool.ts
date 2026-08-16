import { applyTransformToPoint, boundsCenter, type PageObject, type PageObjectId } from "@renote/core";
import type { InkStrokeEngineObject } from "../objects/ink-stroke-object-type.js";
import type { SceneGraph } from "../scene/scene-graph.js";
import type { SelectionManager } from "../selection/selection-manager.js";
import type { NormalizedPointerEvent } from "../input/pointer-event.js";
import { pointInPolygon, type PolygonPoint } from "./point-in-polygon.js";
import type { Tool } from "./tool.js";

/** Below this total drag distance (page units), a gesture counts as a click, not a lasso drag. */
const CLICK_DISTANCE_THRESHOLD = 4;

/**
 * Freeform polygon selection. Captures raw pointer points while the pointer is down (no
 * smoothing — the lasso shape itself is never rendered/persisted as an object, only used to
 * test membership at `onPointerUp`), then selects:
 *  - `ink-stroke` objects: if ANY of the stroke's actual `data.points` falls inside the lasso
 *    polygon (real ink-intersection, not the stroke's bounding box).
 *  - every other object type: if any corner of `object.bounds` falls inside the polygon (a
 *    general-purpose fallback that works for any registered type without special-casing it).
 *
 * A single click (no meaningful drag distance) clears the selection instead of selecting
 * everything under a degenerate zero-area polygon.
 */
export class LassoSelectTool implements Tool {
  readonly id = "lasso";
  readonly cursor = "crosshair";

  private activePointerId: number | null = null;
  private path: PolygonPoint[] = [];

  constructor(
    private readonly scene: SceneGraph,
    private readonly selection: SelectionManager,
  ) {}

  onPointerDown(event: NormalizedPointerEvent): void {
    if (this.activePointerId !== null) return;
    this.activePointerId = event.pointerId;
    this.path = [{ x: event.x, y: event.y }];
  }

  onPointerMove(event: NormalizedPointerEvent): void {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) return;
    this.path.push({ x: event.x, y: event.y });
  }

  onPointerUp(event: NormalizedPointerEvent): void {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) return;
    this.path.push({ x: event.x, y: event.y });
    this.finishLasso();
  }

  onCancel(): void {
    this.reset();
  }

  private finishLasso(): void {
    if (!this.isMeaningfulDrag()) {
      this.selection.clear();
      this.reset();
      return;
    }

    const selected: PageObjectId[] = [];
    for (const object of this.scene.all) {
      if (this.isSelected(object)) selected.push(object.id);
    }
    this.selection.set(selected);
    this.reset();
  }

  /**
   * `object.bounds`/`data` are in the object's own local (pre-transform) space (see
   * `transform.ts`'s doc comment) while `this.path` is the lasso's real world-space pointer
   * trail, so every candidate point/corner is forward-transformed to world space — pivoted at
   * `boundsCenter(object.bounds)`, matching every other transform-aware consumer — before the
   * polygon test. A no-op under an identity transform.
   */
  private isSelected(object: PageObject): boolean {
    const pivot = boundsCenter(object.bounds);
    if (object.type === "ink-stroke") {
      const stroke = object as InkStrokeEngineObject;
      return stroke.data.points.some((point) =>
        pointInPolygon(applyTransformToPoint(point, object.transform, pivot), this.path),
      );
    }
    const { x, y, width, height } = object.bounds;
    const corners: PolygonPoint[] = [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ].map((corner) => applyTransformToPoint(corner, object.transform, pivot));
    return corners.some((corner) => pointInPolygon(corner, this.path));
  }

  private isMeaningfulDrag(): boolean {
    if (this.path.length < 2) return false;
    const first = this.path[0]!;
    let maxDistance = 0;
    for (const point of this.path) {
      maxDistance = Math.max(maxDistance, Math.hypot(point.x - first.x, point.y - first.y));
    }
    return maxDistance >= CLICK_DISTANCE_THRESHOLD;
  }

  private reset(): void {
    this.activePointerId = null;
    this.path = [];
  }
}
