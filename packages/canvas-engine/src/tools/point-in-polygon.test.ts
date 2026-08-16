import { describe, expect, it } from "vitest";
import { pointInPolygon } from "./point-in-polygon.js";

describe("pointInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("returns true for a point inside a simple square", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it("returns false for a point outside a simple square", () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(false);
  });

  it("returns false for a point inside the square's bounding box but outside an L-shaped polygon", () => {
    const lShape = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 40, y: 100 },
      { x: 40, y: 40 },
      { x: 100, y: 40 },
      { x: 100, y: 0 },
    ];
    // (70, 70) sits in the L-shape's bounding box (0,0)-(100,100), but not in the L itself.
    expect(pointInPolygon({ x: 70, y: 70 }, lShape)).toBe(false);
    // (20, 20) is genuinely inside the L.
    expect(pointInPolygon({ x: 20, y: 20 }, lShape)).toBe(true);
  });

  it("returns false for a degenerate polygon with fewer than 3 points", () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(
      pointInPolygon({ x: 0, y: 0 }, [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe(false);
  });
});
