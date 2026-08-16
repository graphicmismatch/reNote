import type { StrokePoint } from "./stroke-point.js";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function interpolateScalar(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Fits raw pointer samples to a Catmull-Rom spline, producing a smoothed
 * polyline with interpolated pressure. This is the smoothing step called
 * out in the project plan for ink capture; tessellation into batched
 * WebGL geometry and tile baking (also plan-specified) are separate,
 * later steps that consume this function's output.
 */
export function smoothStroke(points: readonly StrokePoint[], samplesPerSegment = 8): StrokePoint[] {
  if (points.length < 3) {
    return [...points];
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const padded = [first, ...points, last];
  const smoothed: StrokePoint[] = [];

  for (let i = 0; i < padded.length - 3; i += 1) {
    const p0 = padded[i]!;
    const p1 = padded[i + 1]!;
    const p2 = padded[i + 2]!;
    const p3 = padded[i + 3]!;
    for (let s = 0; s < samplesPerSegment; s += 1) {
      const t = s / samplesPerSegment;
      smoothed.push({
        x: interpolateScalar(p0.x, p1.x, p2.x, p3.x, t),
        y: interpolateScalar(p0.y, p1.y, p2.y, p3.y, t),
        pressure: clamp01(interpolateScalar(p0.pressure, p1.pressure, p2.pressure, p3.pressure, t)),
      });
    }
  }

  smoothed.push(last);
  return smoothed;
}
