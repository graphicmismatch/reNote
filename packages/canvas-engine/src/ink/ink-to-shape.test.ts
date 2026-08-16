import { describe, expect, it } from "vitest";
import { recognizeShape, straightenStroke } from "./ink-to-shape.js";
import type { StrokePoint } from "./stroke-point.js";

/** Samples the perimeter of an axis-aligned rectangle, corner to corner, back to the start. */
function rectanglePoints(x: number, y: number, width: number, height: number, perEdge = 12): StrokePoint[] {
  const corners: [number, number][] = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
    [x, y],
  ];
  const points: StrokePoint[] = [];
  for (let edge = 0; edge < corners.length - 1; edge += 1) {
    const [ax, ay] = corners[edge]!;
    const [bx, by] = corners[edge + 1]!;
    for (let i = 0; i < perEdge; i += 1) {
      const t = i / perEdge;
      points.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, pressure: 1 });
    }
  }
  points.push({ x, y, pressure: 1 });
  return points;
}

/** Samples the perimeter of an axis-aligned ellipse. */
function ellipsePoints(cx: number, cy: number, rx: number, ry: number, samples = 48): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = (i / samples) * Math.PI * 2;
    points.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t), pressure: 1 });
  }
  return points;
}

/** A near-straight line with tiny jitter, so it isn't a perfectly synthetic edge case. */
function linePoints(x1: number, y1: number, x2: number, y2: number, samples = 20): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const jitter = i % 2 === 0 ? 0.4 : -0.4;
    points.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t + jitter, pressure: 1 });
  }
  return points;
}

/** An irregular zigzag scribble: not straight, and its start/end aren't close relative to its
 *  own bbox, so it should not satisfy either the line or closed-loop heuristics. */
function scribblePoints(): StrokePoint[] {
  const raw: [number, number][] = [
    [0, 0],
    [15, 40],
    [5, 10],
    [50, 60],
    [10, 5],
    [70, 20],
    [20, 80],
    [90, 5],
    [30, 50],
    [60, 90],
  ];
  return raw.map(([x, y]) => ({ x, y, pressure: 1 }));
}

describe("recognizeShape", () => {
  it("identifies a synthetic near-rectangle point set", () => {
    const result = recognizeShape(rectanglePoints(0, 0, 100, 60));
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("rectangle");
    expect(result!.bounds.width).toBeCloseTo(100, 0);
    expect(result!.bounds.height).toBeCloseTo(60, 0);
  });

  it("identifies a synthetic near-ellipse point set", () => {
    const result = recognizeShape(ellipsePoints(50, 50, 40, 25));
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("ellipse");
  });

  it("identifies a synthetic near-straight-line point set", () => {
    const result = recognizeShape(linePoints(0, 0, 100, 10));
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("line");
  });

  it("preserves the actual drawn direction of a recognized line, not just its bounds", () => {
    // Drawn from bottom-right to top-left — same bounds as the opposite direction would
    // produce, but the recognized line must remember which way it was actually drawn.
    const result = recognizeShape(linePoints(100, 10, 0, 0));
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("line");
    // linePoints() adds +/-0.4 jitter to y, so compare approximately rather than exactly.
    expect(result!.startPoint!.x).toBeCloseTo(100, 0);
    expect(result!.startPoint!.y).toBeCloseTo(10, 0);
    expect(result!.endPoint!.x).toBeCloseTo(0, 0);
    expect(result!.endPoint!.y).toBeCloseTo(0, 0);
  });

  it("returns null for an obviously irregular scribble", () => {
    const result = recognizeShape(scribblePoints());
    expect(result).toBeNull();
  });

  it("returns null for too few points", () => {
    expect(recognizeShape([{ x: 0, y: 0, pressure: 1 }])).toBeNull();
  });
});

describe("straightenStroke", () => {
  it("snaps a near-straight stroke onto its chord, preserving endpoint pressure", () => {
    const points = linePoints(0, 0, 100, 10);
    points[0]!.pressure = 0.3;
    points[points.length - 1]!.pressure = 0.9;
    const result = straightenStroke(points);
    expect(result).not.toBeNull();
    expect(result!.start.x).toBeCloseTo(0, 0);
    expect(result!.start.y).toBeCloseTo(0, 0);
    expect(result!.start.pressure).toBe(0.3);
    expect(result!.end.x).toBeCloseTo(100, 0);
    expect(result!.end.y).toBeCloseTo(10, 0);
    expect(result!.end.pressure).toBe(0.9);
  });

  it("returns null for a stroke that isn't near-collinear", () => {
    expect(straightenStroke(scribblePoints())).toBeNull();
  });

  it("returns null for a closed loop (not a line)", () => {
    expect(straightenStroke(rectanglePoints(0, 0, 100, 60))).toBeNull();
  });
});
