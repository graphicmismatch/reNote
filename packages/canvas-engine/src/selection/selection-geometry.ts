import {
  applyTransformToPoint,
  boundsCenter,
  transformedBounds,
  type Bounds,
  type PageObject,
  type Point2D,
} from "@renote/core";
import type { ObjectTypeRegistry } from "../objects/registry.js";

export type ResizeHandleId = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type HandleId = "rotate" | ResizeHandleId;

export interface SelectionHandle {
  readonly id: HandleId;
  /** World-space position. */
  readonly x: number;
  readonly y: number;
}

export interface SelectionGeometry {
  /** World-space AABB covering the whole selection (union across every selected object). */
  readonly bounds: Bounds;
  /** World-space anchor every rotate/scale gesture on this selection is applied around. */
  readonly pivot: Point2D;
  /**
   * Orientation of the selection outline itself — a single selected object's own
   * `transform.rotation` (so its handles visually track the object as it turns), or 0 for a
   * multi-object selection (see class doc comment on why the group box stays axis-aligned).
   */
  readonly rotation: number;
  /**
   * The outline box's own (scaled, pre-rotation) width/height, centered on `pivot` and turned by
   * `rotation` — this is NOT the same rectangle as `bounds`: `bounds` is the AABB of that
   * already-rotated box (wider/taller than the box itself whenever `rotation` isn't a multiple
   * of 90 degrees), which is the right shape for a "does this touch the selection" broad-phase
   * check but the WRONG shape to actually draw — drawing `bounds` and then rotating it by
   * `rotation` again would double-apply the rotation. A renderer wants `size` + `pivot` +
   * `rotation` together, not `bounds`.
   */
  readonly size: { readonly width: number; readonly height: number };
  readonly canRotate: boolean;
  readonly canResize: boolean;
  readonly handles: readonly SelectionHandle[];
}

/** Rotate handle's distance above the selection's top edge, in constant screen pixels. */
export const ROTATE_HANDLE_OFFSET_PX = 24;
/** How close (screen pixels) a pointer-down must land to a handle to grab it instead of the
 *  object underneath. */
export const HANDLE_HIT_TOLERANCE_PX = 8;

function rotateVector(v: Point2D, angle: number): Point2D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

function localResizeHandles(bounds: Bounds): Record<ResizeHandleId, Point2D> {
  const { x, y, width, height } = bounds;
  return {
    nw: { x, y },
    n: { x: x + width / 2, y },
    ne: { x: x + width, y },
    e: { x: x + width, y: y + height / 2 },
    se: { x: x + width, y: y + height },
    s: { x: x + width / 2, y: y + height },
    sw: { x, y: y + height },
    w: { x, y: y + height / 2 },
  };
}

function capabilities(
  objects: readonly PageObject[],
  objectTypes: ObjectTypeRegistry,
): { canRotate: boolean; canResize: boolean } {
  let canRotate = true;
  let canResize = true;
  for (const object of objects) {
    if (!objectTypes.has(object.type)) continue;
    const definition = objectTypes.get(object.type);
    if (!definition.supportsRotation) canRotate = false;
    if (!definition.supportsResize) canResize = false;
  }
  return { canRotate, canResize };
}

function unionBounds(boundsList: readonly Bounds[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boundsList) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Computes the world-space selection outline/handle layout for the currently-selected objects —
 * a pure function shared by `SelectTool` (which hit-tests pointer-downs against `handles` to
 * start a rotate/scale gesture) and `apps/desktop`'s visual overlay (which just draws it). See
 * `transform.ts`'s doc comment for the local-vs-world-space convention every position here
 * follows.
 *
 * A single selected object gets handles computed from its OWN local bounds and transform, so
 * they visually track it as it rotates/scales. A multi-object selection instead uses the
 * axis-aligned union of every member's world bounds, with `rotation` fixed at 0 — a deliberate
 * simplification: rotating/scaling a multi-selection still applies a real per-object transform
 * delta around the shared `pivot` (see `SelectTool`), but the selection outline itself doesn't
 * re-orient live mid-gesture the way a single object's does, only catching up to the new tight
 * bounds once the gesture commits.
 *
 * `zoom` is the current camera zoom — needed only to convert `ROTATE_HANDLE_OFFSET_PX` (a
 * constant on-screen distance) into world units, so the rotate handle sits the same visual
 * distance from the selection at any zoom level.
 */
export function computeSelectionGeometry(
  objects: readonly PageObject[],
  objectTypes: ObjectTypeRegistry,
  zoom: number,
): SelectionGeometry | null {
  if (objects.length === 0) return null;

  const { canRotate, canResize } = capabilities(objects, objectTypes);
  const rotateOffsetWorld = ROTATE_HANDLE_OFFSET_PX / zoom;

  if (objects.length === 1) {
    const object = objects[0]!;
    const pivot = boundsCenter(object.bounds);
    const worldPivot = applyTransformToPoint(pivot, object.transform, pivot);
    const localHandles = localResizeHandles(object.bounds);

    const handles: SelectionHandle[] = [];
    if (canResize) {
      for (const [id, local] of Object.entries(localHandles) as [ResizeHandleId, Point2D][]) {
        const world = applyTransformToPoint(local, object.transform, pivot);
        handles.push({ id, x: world.x, y: world.y });
      }
    }
    if (canRotate) {
      const topCenterWorld = applyTransformToPoint(localHandles.n, object.transform, pivot);
      const offset = rotateVector({ x: 0, y: -rotateOffsetWorld }, object.transform.rotation);
      handles.push({ id: "rotate", x: topCenterWorld.x + offset.x, y: topCenterWorld.y + offset.y });
    }

    return {
      bounds: transformedBounds(object.bounds, object.transform),
      pivot: worldPivot,
      rotation: object.transform.rotation,
      size: {
        width: object.bounds.width * Math.abs(object.transform.scaleX),
        height: object.bounds.height * Math.abs(object.transform.scaleY),
      },
      canRotate,
      canResize,
      handles,
    };
  }

  const bounds = unionBounds(objects.map((object) => transformedBounds(object.bounds, object.transform)));
  const pivot = boundsCenter(bounds);
  const localHandles = localResizeHandles(bounds);

  const handles: SelectionHandle[] = [];
  if (canResize) {
    for (const [id, position] of Object.entries(localHandles) as [ResizeHandleId, Point2D][]) {
      handles.push({ id, x: position.x, y: position.y });
    }
  }
  if (canRotate) {
    handles.push({ id: "rotate", x: localHandles.n.x, y: localHandles.n.y - rotateOffsetWorld });
  }

  return {
    bounds,
    pivot,
    rotation: 0,
    size: { width: bounds.width, height: bounds.height },
    canRotate,
    canResize,
    handles,
  };
}

/** Finds the handle (if any) within `HANDLE_HIT_TOLERANCE_PX`/`zoom` world units of `point`. */
export function hitTestHandle(
  geometry: SelectionGeometry,
  point: Point2D,
  zoom: number,
): SelectionHandle | null {
  const tolerance = HANDLE_HIT_TOLERANCE_PX / zoom;
  let closest: SelectionHandle | null = null;
  let closestDistance = Infinity;
  for (const handle of geometry.handles) {
    const distance = Math.hypot(handle.x - point.x, handle.y - point.y);
    if (distance <= tolerance && distance < closestDistance) {
      closest = handle;
      closestDistance = distance;
    }
  }
  return closest;
}
