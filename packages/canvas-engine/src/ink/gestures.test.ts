import { describe, expect, it } from "vitest";
import { isScratchOutGesture } from "./gestures.js";
import type { StrokePoint } from "./stroke-point.js";

/** A back-and-forth zigzag confined to a narrow band — the paper shorthand for "delete this". */
function zigzagPoints(steps: number, width: number, height: number): StrokePoint[] {
  const stepWidth = width / steps;
  const points: StrokePoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    points.push({ x: i * stepWidth, y: i % 2 === 0 ? 0 : height, pressure: 1 });
  }
  return points;
}

function linePoints(x1: number, y1: number, x2: number, y2: number, samples = 20): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    points.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, pressure: 1 });
  }
  return points;
}

describe("isScratchOutGesture", () => {
  it("recognizes a thin, many-reversal zigzag as a scratch-out", () => {
    expect(isScratchOutGesture(zigzagPoints(6, 20, 6))).toBe(true);
  });

  it("rejects a plain straight line (no reversals)", () => {
    expect(isScratchOutGesture(linePoints(0, 0, 100, 0))).toBe(false);
  });

  it("rejects a zigzag with too few reversals", () => {
    expect(isScratchOutGesture(zigzagPoints(2, 20, 6))).toBe(false);
  });

  it("rejects a zigzag whose bounding box isn't thin (square-ish amplitude)", () => {
    expect(isScratchOutGesture(zigzagPoints(6, 10, 10))).toBe(false);
  });

  it("rejects a degenerate near-point stroke", () => {
    expect(isScratchOutGesture(zigzagPoints(6, 0.5, 0.2))).toBe(false);
  });
});
