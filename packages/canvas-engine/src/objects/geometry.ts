/**
 * Small geometry helpers shared across object types that need point-to-segment distance
 * (ink strokes, and shape line/arrow hit-testing) so the math is written once. Deliberately
 * takes/returns plain `{x, y}` shapes rather than importing `HitTestPoint`/`StrokePoint` here,
 * so this module has no dependency on either object type's specifics.
 */
export interface Point2D {
  x: number;
  y: number;
}

/** Distance from `point` to the line segment `a`-`b`. */
export function distanceToSegment(point: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  const projectedX = a.x + t * dx;
  const projectedY = a.y + t * dy;
  return Math.hypot(point.x - projectedX, point.y - projectedY);
}
