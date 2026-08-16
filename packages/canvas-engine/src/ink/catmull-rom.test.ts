import { describe, expect, it } from "vitest";
import { smoothStroke } from "./catmull-rom.js";

describe("smoothStroke", () => {
  it("returns the input unchanged when there are fewer than 3 points", () => {
    const points = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 10, y: 10, pressure: 0.6 },
    ];
    expect(smoothStroke(points)).toEqual(points);
  });

  it("passes through the first and last input points", () => {
    const points = [
      { x: 0, y: 0, pressure: 0.2 },
      { x: 5, y: 5, pressure: 0.4 },
      { x: 10, y: 0, pressure: 0.6 },
      { x: 15, y: 5, pressure: 0.8 },
    ];
    const smoothed = smoothStroke(points, 4);

    expect(smoothed[0]).toEqual(points[0]);
    expect(smoothed[smoothed.length - 1]).toEqual(points[points.length - 1]);
  });

  it("produces more points than the input for multi-segment strokes", () => {
    const points = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 5, y: 5, pressure: 0.5 },
      { x: 10, y: 0, pressure: 0.5 },
      { x: 15, y: 5, pressure: 0.5 },
    ];
    const smoothed = smoothStroke(points, 8);
    expect(smoothed.length).toBeGreaterThan(points.length);
  });

  it("keeps interpolated pressure within [0, 1] even with non-monotonic input", () => {
    const points = [
      { x: 0, y: 0, pressure: 0 },
      { x: 5, y: 0, pressure: 1 },
      { x: 10, y: 0, pressure: 0 },
      { x: 15, y: 0, pressure: 1 },
      { x: 20, y: 0, pressure: 0 },
    ];
    const smoothed = smoothStroke(points, 16);
    for (const point of smoothed) {
      expect(point.pressure).toBeGreaterThanOrEqual(0);
      expect(point.pressure).toBeLessThanOrEqual(1);
    }
  });
});
