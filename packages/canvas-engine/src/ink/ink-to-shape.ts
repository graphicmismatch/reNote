import type { Bounds, ShapeData } from "@renote/core";
import type { StrokePoint } from "./stroke-point.js";

export interface RecognizedShape {
  kind: ShapeData["kind"];
  bounds: Bounds;
  /** Only set for kind "line" — the stroke's actual first/last points, so the recognized
   *  line preserves the direction the user actually drew, not just its bounding box. */
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
}

/** Below this many points there isn't enough signal to recognize anything confidently. */
const MIN_POINTS = 5;
/** A bounding-box diagonal smaller than this (page units) is treated as a degenerate dot/tap. */
const MIN_DIAGONAL = 4;
/** Start/end within this fraction of the bbox diagonal counts as "closed" (a loop). */
const CLOSURE_TOLERANCE = 0.22;
/** Max perpendicular deviation from the first->last chord, as a fraction of chord length, to
 *  still count as "straight" (a line). */
const STRAIGHTNESS_TOLERANCE = 0.12;
/** Turning-angle magnitude (radians) above which a sampled point counts as a candidate corner. */
const CORNER_ANGLE_THRESHOLD = (32 * Math.PI) / 180;

export function boundsOf(points: readonly StrokePoint[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Shoelace formula; works on the raw (possibly non-convex) point path as a closed polygon. */
function polygonArea(points: readonly StrokePoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Counts distinct "dominant corner" locations by sampling the stroke at a coarse stride,
 * measuring the turning angle at each sampled point, and clustering nearby high-turning-angle
 * points into single corners (a real corner gets hit by several consecutive raw samples).
 */
function countDominantCorners(points: readonly StrokePoint[], diagonal: number): number {
  const stride = Math.max(1, Math.floor(points.length / 40));
  const sampled: StrokePoint[] = [];
  for (let i = 0; i < points.length; i += stride) sampled.push(points[i]!);
  if (sampled.length < 5) return 0;

  const cornerPoints: StrokePoint[] = [];
  for (let i = 1; i < sampled.length - 1; i += 1) {
    const prev = sampled[i - 1]!;
    const cur = sampled[i]!;
    const next = sampled[i + 1]!;
    const inX = cur.x - prev.x;
    const inY = cur.y - prev.y;
    const outX = next.x - cur.x;
    const outY = next.y - cur.y;
    const inLen = Math.hypot(inX, inY);
    const outLen = Math.hypot(outX, outY);
    if (inLen < 1e-6 || outLen < 1e-6) continue;
    const cos = Math.max(-1, Math.min(1, (inX * outX + inY * outY) / (inLen * outLen)));
    const turn = Math.acos(cos);
    if (turn >= CORNER_ANGLE_THRESHOLD) cornerPoints.push(cur);
  }

  const mergeDistance = Math.max(1, diagonal * 0.12);
  const clusters: StrokePoint[] = [];
  for (const point of cornerPoints) {
    const nearExisting = clusters.some((c) => Math.hypot(c.x - point.x, c.y - point.y) <= mergeDistance);
    if (!nearExisting) clusters.push(point);
  }
  return clusters.length;
}

/**
 * Pure geometric shape recognition (no ML, per the project plan). Runs three heuristics in
 * order and returns the first confident match, or `null` if nothing matches:
 *
 * 1. Straight line: first/last points far apart relative to the bbox, and every point stays
 *    close to the chord between them (small perpendicular deviation).
 * 2. Rectangle: a roughly-closed loop (start near end) whose shoelace-area/bbox-area ratio is
 *    close to 1 (a rectangle fills nearly its whole bbox) AND has ~4 dominant corners.
 * 3. Ellipse: a roughly-closed loop whose area ratio is close to an inscribed ellipse's
 *    (pi/4 ~= 0.785) AND has few/no dominant corners (a smooth curve has no sharp turns).
 *
 * Both closed-loop checks share the same closure test, so a self-intersecting scribble that
 * happens to end near where it started still has to pass the area-ratio *and* corner-count
 * bar to be classified — an irregular scribble is expected to fail both and return null.
 */
export function recognizeShape(points: readonly StrokePoint[]): RecognizedShape | null {
  if (points.length < MIN_POINTS) return null;

  const bounds = boundsOf(points);
  const diagonal = Math.hypot(bounds.width, bounds.height);
  if (!Number.isFinite(diagonal) || diagonal < MIN_DIAGONAL) return null;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const chordLength = Math.hypot(last.x - first.x, last.y - first.y);
  const closureDistance = chordLength;

  // 1. Straight line: endpoints far apart (not a closed loop) and low deviation from the chord.
  if (chordLength >= diagonal * 0.5) {
    let maxDeviation = 0;
    for (const p of points) {
      maxDeviation = Math.max(maxDeviation, distanceToSegment(p.x, p.y, first.x, first.y, last.x, last.y));
    }
    if (maxDeviation <= STRAIGHTNESS_TOLERANCE * Math.max(chordLength, 1)) {
      return {
        kind: "line",
        bounds,
        startPoint: { x: first.x, y: first.y },
        endPoint: { x: last.x, y: last.y },
      };
    }
    return null;
  }

  // 2/3. Closed loop -> rectangle or ellipse, distinguished by area-fill-ratio + corner count.
  if (closureDistance <= CLOSURE_TOLERANCE * diagonal) {
    const bboxArea = bounds.width * bounds.height;
    if (bboxArea <= 0) return null;
    const areaRatio = polygonArea(points) / bboxArea;
    const corners = countDominantCorners(points, diagonal);

    if (areaRatio >= 0.75 && corners >= 3 && corners <= 6) {
      return { kind: "rectangle", bounds };
    }
    if (areaRatio >= 0.55 && areaRatio < 0.92 && corners <= 2) {
      return { kind: "ellipse", bounds };
    }
    return null;
  }

  return null;
}

/**
 * Snaps a near-collinear stroke onto the chord `recognizeShape` would draw for it, for the
 * "Straighten Stroke" action — same straightness check "Convert to Shape" uses, gated the same
 * way, so a stroke too curved to read as a line is left untouched rather than force-straightened.
 * Endpoint pressures are preserved from the original stroke; only position moves onto the chord.
 */
export function straightenStroke(
  points: readonly StrokePoint[],
): { start: StrokePoint; end: StrokePoint } | null {
  const recognized = recognizeShape(points);
  if (!recognized || recognized.kind !== "line" || !recognized.startPoint || !recognized.endPoint) {
    return null;
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return {
    start: { ...recognized.startPoint, pressure: first.pressure },
    end: { ...recognized.endPoint, pressure: last.pressure },
  };
}
