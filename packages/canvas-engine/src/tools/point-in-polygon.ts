/**
 * Standalone ray-casting point-in-polygon test (even-odd rule), used by `LassoSelectTool` for
 * both the ink-stroke real-points test and the bounds-corner fallback for other object types.
 * Kept dependency-free (plain `{x,y}` in/out) so it's trivially unit-testable on its own.
 */
export interface PolygonPoint {
  x: number;
  y: number;
}

export function pointInPolygon(point: PolygonPoint, polygon: readonly PolygonPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}
