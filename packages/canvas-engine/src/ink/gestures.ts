import { boundsOf } from "./ink-to-shape.js";
import type { StrokePoint } from "./stroke-point.js";

/** A turn sharper than this between consecutive segments counts as "doubled back" — tight
 *  enough that jitter within a single stroke direction can't trigger it, but loose enough to
 *  catch a real scratch-out's rounded turnarounds. */
const REVERSAL_COS_THRESHOLD = Math.cos((120 * Math.PI) / 180);
/** Below this many reversals, it reads as an ordinary wiggly stroke, not a scratch-out. */
const MIN_REVERSALS = 4;
/** A scratch-out is a back-and-forth scribble confined to a narrow band, not a filled area —
 *  short side of the bbox must stay under this fraction of the long side. */
const MAX_ASPECT_RATIO = 0.4;
const MIN_DIAGONAL = 6;

/**
 * Detects the "scratch it out" gesture: a thin, elongated back-and-forth scribble, the same
 * shorthand people use on paper to delete something. Pure geometry — direction reversals
 * (consecutive segments turning back on themselves) inside a bounding box much longer than it
 * is wide. `PenTool.commitStroke` runs this on the smoothed stroke and, on a match that
 * overlaps existing objects, deletes what it crossed instead of committing the scribble as ink.
 */
export function isScratchOutGesture(points: readonly StrokePoint[]): boolean {
  if (points.length < MIN_REVERSALS + 2) return false;

  const bounds = boundsOf(points);
  const long = Math.max(bounds.width, bounds.height);
  const short = Math.min(bounds.width, bounds.height);
  if (long < MIN_DIAGONAL) return false;
  if (short / long > MAX_ASPECT_RATIO) return false;

  let reversals = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;
    const inX = cur.x - prev.x;
    const inY = cur.y - prev.y;
    const outX = next.x - cur.x;
    const outY = next.y - cur.y;
    const inLen = Math.hypot(inX, inY);
    const outLen = Math.hypot(outX, outY);
    if (inLen < 1e-6 || outLen < 1e-6) continue;
    const cos = (inX * outX + inY * outY) / (inLen * outLen);
    if (cos <= REVERSAL_COS_THRESHOLD) reversals += 1;
  }
  return reversals >= MIN_REVERSALS;
}
