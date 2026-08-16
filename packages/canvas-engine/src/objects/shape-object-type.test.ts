import { describe, expect, it } from "vitest";
import { Graphics } from "pixi.js";
import { identityTransform, newId, type PageObjectId, type ShapeData } from "@renote/core";
import { shapeObjectType, type ShapeObject } from "./shape-object-type.js";

function makeShape(kind: ShapeData["kind"], bounds: ShapeObject["bounds"]): ShapeObject {
  return {
    id: newId<PageObjectId>(),
    type: "shape",
    transform: identityTransform(),
    bounds,
    data: { kind, strokeColor: "#000000", strokeWidth: 2, fillColor: null },
  };
}

describe("shapeObjectType", () => {
  it("hit-tests a rectangle via bounds containment", () => {
    const shape = makeShape("rectangle", { x: 0, y: 0, width: 100, height: 50 });
    expect(shapeObjectType.hitTest(shape, { x: 50, y: 25 })).toBe(true);
    expect(shapeObjectType.hitTest(shape, { x: 500, y: 500 })).toBe(false);
  });

  it("hit-tests an ellipse via bounds containment", () => {
    const shape = makeShape("ellipse", { x: 0, y: 0, width: 100, height: 50 });
    expect(shapeObjectType.hitTest(shape, { x: 50, y: 25 })).toBe(true);
    expect(shapeObjectType.hitTest(shape, { x: -10, y: -10 })).toBe(false);
  });

  it("hit-tests a line via point-to-segment distance along the bounds diagonal, not the bbox corners", () => {
    const shape = makeShape("line", { x: 0, y: 0, width: 100, height: 100 });
    // Near the diagonal (0,0)->(100,100): hits.
    expect(shapeObjectType.hitTest(shape, { x: 50, y: 51 })).toBe(true);
    // Near the opposite corner of the bbox, far from the diagonal itself: misses.
    expect(shapeObjectType.hitTest(shape, { x: 0, y: 100 })).toBe(false);
  });

  it("hit-tests a line along its actual stored direction when startPoint/endPoint are set, not the bounds diagonal", () => {
    const shape: ShapeObject = {
      id: newId<PageObjectId>(),
      type: "shape",
      transform: identityTransform(),
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      data: {
        kind: "line",
        strokeColor: "#000000",
        strokeWidth: 2,
        fillColor: null,
        // Opposite diagonal from the bounds-fallback one (0,0)->(100,100).
        startPoint: { x: 0, y: 100 },
        endPoint: { x: 100, y: 0 },
      },
    };
    // On the actual (0,100)->(100,0) line (x+y=100): hits.
    expect(shapeObjectType.hitTest(shape, { x: 25, y: 75 })).toBe(true);
    // On the (0,0)->(100,100) diagonal the old bounds-only logic would have used instead
    // (x=y), far from the actual stored line: misses.
    expect(shapeObjectType.hitTest(shape, { x: 25, y: 25 })).toBe(false);
  });

  it("hit-tests an arrow the same way as a line", () => {
    const shape = makeShape("arrow", { x: 0, y: 0, width: 100, height: 0 });
    expect(shapeObjectType.hitTest(shape, { x: 50, y: 0.5 })).toBe(true);
    expect(shapeObjectType.hitTest(shape, { x: 50, y: 50 })).toBe(false);
  });

  it("validates well-formed data and rejects malformed data", () => {
    const good = { kind: "rectangle", strokeColor: "#000000", strokeWidth: 2, fillColor: null };
    expect(shapeObjectType.validate(good)).toEqual(good);
    expect(() => shapeObjectType.validate(null)).toThrow();
    expect(() => shapeObjectType.validate({ ...good, kind: "triangle" })).toThrow();
    expect(() => shapeObjectType.validate({ ...good, fillColor: 5 })).toThrow();
  });

  it("createView/updateView run against every kind without throwing", () => {
    for (const kind of ["rectangle", "ellipse", "line", "arrow"] as const) {
      const shape = makeShape(kind, { x: 0, y: 0, width: 40, height: 20 });
      const view = shapeObjectType.createView(shape, { x: 0, y: 0 });
      expect(() => shapeObjectType.updateView(view, shape, { x: 0, y: 0 })).not.toThrow();
    }
  });

  it("draws chunk-local geometry when given a non-zero origin, not raw world coordinates", () => {
    const shape = makeShape("rectangle", { x: 1_000_000, y: 1_000_000, width: 40, height: 20 });
    const origin = { x: 999_000, y: 999_000 };
    const view = shapeObjectType.createView(shape, origin) as Graphics;
    const bounds = view.getLocalBounds();

    // Chunk-local: near (1000, 1000), not (1_000_000, 1_000_000).
    expect(bounds.x).toBeGreaterThan(900);
    expect(bounds.x).toBeLessThan(1100);
    expect(bounds.y).toBeGreaterThan(900);
    expect(bounds.y).toBeLessThan(1100);
  });
});
