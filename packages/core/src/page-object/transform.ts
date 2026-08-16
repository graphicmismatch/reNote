export interface Transform2D {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  zIndex: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export function identityTransform(zIndex = 0): Transform2D {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, zIndex };
}

/**
 * `bounds`/`data` on a `PageObject` describe its permanent shape in its own local (unrotated,
 * unscaled, untranslated) space; `transform` is the affine applied on top, always anchored to
 * `boundsCenter(object.bounds)` as the pivot — so rotating/scaling an object turns/grows it
 * around its own visual center, never around an arbitrary corner or the world origin. This is
 * the one shared pivot convention every consumer below (and `PixiRenderer.syncObject`, which
 * mirrors this exact math for rendering) must use, so a click that hit-tests correctly and a
 * shape that renders correctly always agree on where the object actually is.
 */
export function boundsCenter(bounds: Bounds): Point2D {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/** Local (pre-transform) point -> world (post-transform) point, rotating/scaling around `pivot`. */
export function applyTransformToPoint(point: Point2D, transform: Transform2D, pivot: Point2D): Point2D {
  const dx = (point.x - pivot.x) * transform.scaleX;
  const dy = (point.y - pivot.y) * transform.scaleY;
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  return {
    x: pivot.x + transform.x + dx * cos - dy * sin,
    y: pivot.y + transform.y + dx * sin + dy * cos,
  };
}

/** Inverse of `applyTransformToPoint`: world (post-transform) point -> local (pre-transform) point. */
export function invertTransformPoint(point: Point2D, transform: Transform2D, pivot: Point2D): Point2D {
  const dx = point.x - pivot.x - transform.x;
  const dy = point.y - pivot.y - transform.y;
  const cos = Math.cos(-transform.rotation);
  const sin = Math.sin(-transform.rotation);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return {
    x: pivot.x + rx / (transform.scaleX || 1),
    y: pivot.y + ry / (transform.scaleY || 1),
  };
}

/**
 * World-space axis-aligned bounding box of `bounds` after `transform` is applied (pivoted at
 * `boundsCenter(bounds)`) — the four local corners, transformed to world space, then re-fit to
 * an AABB. Used wherever a broad-phase/AABB view of a transformed object is needed (the spatial
 * index, selection union bounds); an identity transform always returns `bounds` unchanged
 * (same numeric values, new object).
 */
export function transformedBounds(bounds: Bounds, transform: Transform2D): Bounds {
  const pivot = boundsCenter(bounds);
  const corners: Point2D[] = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map((corner) => applyTransformToPoint(corner, transform, pivot));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of corners) {
    minX = Math.min(minX, corner.x);
    minY = Math.min(minY, corner.y);
    maxX = Math.max(maxX, corner.x);
    maxY = Math.max(maxY, corner.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
