import { describe, expect, it } from "vitest";
import {
  applyTransformToPoint,
  boundsCenter,
  identityTransform,
  invertTransformPoint,
  transformedBounds,
  type Bounds,
  type Transform2D,
} from "./transform.js";

describe("boundsCenter", () => {
  it("returns the midpoint of a bounds rect", () => {
    const bounds: Bounds = { x: 10, y: 20, width: 40, height: 10 };
    expect(boundsCenter(bounds)).toEqual({ x: 30, y: 25 });
  });
});

describe("applyTransformToPoint / invertTransformPoint", () => {
  const pivot = { x: 0, y: 0 };

  it("identity transform leaves a point unchanged", () => {
    const point = { x: 12, y: -4 };
    expect(applyTransformToPoint(point, identityTransform(), pivot)).toEqual(point);
    expect(invertTransformPoint(point, identityTransform(), pivot)).toEqual(point);
  });

  it("translates a point by transform.x/y", () => {
    const transform: Transform2D = { ...identityTransform(), x: 5, y: -3 };
    expect(applyTransformToPoint({ x: 1, y: 1 }, transform, pivot)).toEqual({ x: 6, y: -2 });
  });

  it("rotates a point 90 degrees around the pivot", () => {
    const transform: Transform2D = { ...identityTransform(), rotation: Math.PI / 2 };
    const result = applyTransformToPoint({ x: 10, y: 0 }, transform, pivot);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(10);
  });

  it("scales a point around the pivot", () => {
    const transform: Transform2D = { ...identityTransform(), scaleX: 2, scaleY: 3 };
    expect(applyTransformToPoint({ x: 4, y: 4 }, transform, pivot)).toEqual({ x: 8, y: 12 });
  });

  it("rotates and scales around a non-origin pivot", () => {
    const nonOriginPivot = { x: 5, y: 5 };
    const transform: Transform2D = { ...identityTransform(), rotation: Math.PI, scaleX: 2, scaleY: 2 };
    // A point directly "east" of the pivot, scaled 2x then rotated 180deg, lands directly "west".
    const result = applyTransformToPoint({ x: 10, y: 5 }, transform, nonOriginPivot);
    expect(result.x).toBeCloseTo(-5);
    expect(result.y).toBeCloseTo(5);
  });

  it("inverts round-trip for an arbitrary transform", () => {
    const transform: Transform2D = { x: 7, y: -2, rotation: 0.6, scaleX: 1.5, scaleY: 0.8, zIndex: 0 };
    const arbitraryPivot = { x: 3, y: -1 };
    const original = { x: 20, y: 14 };
    const world = applyTransformToPoint(original, transform, arbitraryPivot);
    const roundTripped = invertTransformPoint(world, transform, arbitraryPivot);
    expect(roundTripped.x).toBeCloseTo(original.x);
    expect(roundTripped.y).toBeCloseTo(original.y);
  });
});

describe("transformedBounds", () => {
  const bounds: Bounds = { x: 0, y: 0, width: 10, height: 10 };

  it("returns the same bounds under an identity transform", () => {
    expect(transformedBounds(bounds, identityTransform())).toEqual(bounds);
  });

  it("translates the bounds by transform.x/y", () => {
    const transform: Transform2D = { ...identityTransform(), x: 5, y: 5 };
    expect(transformedBounds(bounds, transform)).toEqual({ x: 5, y: 5, width: 10, height: 10 });
  });

  it("grows the AABB to fit a 45-degree rotated square", () => {
    const transform: Transform2D = { ...identityTransform(), rotation: Math.PI / 4 };
    const result = transformedBounds(bounds, transform);
    const diagonal = Math.SQRT2 * 10;
    expect(result.width).toBeCloseTo(diagonal);
    expect(result.height).toBeCloseTo(diagonal);
    // Still centered on the original center (5, 5).
    expect(result.x + result.width / 2).toBeCloseTo(5);
    expect(result.y + result.height / 2).toBeCloseTo(5);
  });

  it("scales the bounds around its own center", () => {
    const transform: Transform2D = { ...identityTransform(), scaleX: 2, scaleY: 2 };
    const result = transformedBounds(bounds, transform);
    expect(result).toEqual({ x: -5, y: -5, width: 20, height: 20 });
  });
});
