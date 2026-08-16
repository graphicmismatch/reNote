import { identityTransform, type PageObject } from "@renote/core";
import { describe, expect, it } from "vitest";
import type { ObjectTypeDefinition } from "../objects/object-type-definition.js";
import { ObjectTypeRegistry } from "../objects/registry.js";
import { computeSelectionGeometry, hitTestHandle, ROTATE_HANDLE_OFFSET_PX } from "./selection-geometry.js";

function fakeType(type: string, supportsRotation: boolean, supportsResize: boolean): ObjectTypeDefinition {
  return {
    type,
    validate: (data) => data,
    createView: () => {
      throw new Error("not needed for this test");
    },
    updateView: () => {},
    hitTest: () => false,
    supportsRotation,
    supportsResize,
  };
}

function registry(): ObjectTypeRegistry {
  const registry = new ObjectTypeRegistry();
  registry.register(fakeType("full", true, true));
  registry.register(fakeType("move-only", false, false));
  return registry;
}

function objectAt(id: string, type: string, bounds = { x: 0, y: 0, width: 10, height: 10 }): PageObject {
  return { id: id as PageObject["id"], type, transform: identityTransform(), bounds, data: {} };
}

describe("computeSelectionGeometry", () => {
  it("returns null for an empty selection", () => {
    expect(computeSelectionGeometry([], registry(), 1)).toBeNull();
  });

  it("single object: pivot is the bounds center, all 8 resize handles plus rotate present", () => {
    const object = objectAt("a", "full");
    const geometry = computeSelectionGeometry([object], registry(), 1)!;
    expect(geometry.pivot).toEqual({ x: 5, y: 5 });
    expect(geometry.canRotate).toBe(true);
    expect(geometry.canResize).toBe(true);
    expect(geometry.handles).toHaveLength(9);
    const se = geometry.handles.find((h) => h.id === "se")!;
    expect(se).toEqual({ id: "se", x: 10, y: 10 });
    expect(geometry.size).toEqual({ width: 10, height: 10 });
  });

  it("single object: size scales with |transform.scale|, independent of bounds/AABB", () => {
    const scaled: PageObject = {
      ...objectAt("a", "full"),
      transform: { ...identityTransform(), scaleX: 2, scaleY: -3 },
    };
    const geometry = computeSelectionGeometry([scaled], registry(), 1)!;
    expect(geometry.size).toEqual({ width: 20, height: 30 });
  });

  it("single object: capability flags hide handles and gate canRotate/canResize", () => {
    const object = objectAt("a", "move-only");
    const geometry = computeSelectionGeometry([object], registry(), 1)!;
    expect(geometry.canRotate).toBe(false);
    expect(geometry.canResize).toBe(false);
    expect(geometry.handles).toHaveLength(0);
  });

  it("single object: rotate handle sits a constant screen distance above the top edge, rotating with the object", () => {
    const unrotated = objectAt("a", "full");
    const geometry = computeSelectionGeometry([unrotated], registry(), 1)!;
    const rotateHandle = geometry.handles.find((h) => h.id === "rotate")!;
    expect(rotateHandle.x).toBeCloseTo(5);
    expect(rotateHandle.y).toBeCloseTo(-ROTATE_HANDLE_OFFSET_PX);

    const rotated: PageObject = {
      ...unrotated,
      transform: { ...identityTransform(), rotation: Math.PI / 2 },
    };
    const rotatedGeometry = computeSelectionGeometry([rotated], registry(), 1)!;
    const rotatedHandle = rotatedGeometry.handles.find((h) => h.id === "rotate")!;
    // A 90-degree rotation turns the top edge (previously at world x=5,y=0) into the right edge
    // (world x=10,y=5), and the "point outward" offset direction rotates along with it.
    expect(rotatedHandle.x).toBeCloseTo(10 + ROTATE_HANDLE_OFFSET_PX);
    expect(rotatedHandle.y).toBeCloseTo(5);
  });

  it("single object: rotate handle offset shrinks in world units as zoom increases", () => {
    const object = objectAt("a", "full");
    const geometry = computeSelectionGeometry([object], registry(), 2)!;
    const rotateHandle = geometry.handles.find((h) => h.id === "rotate")!;
    expect(rotateHandle.y).toBeCloseTo(-ROTATE_HANDLE_OFFSET_PX / 2);
  });

  it("multi-object: bounds/handles are the axis-aligned union, rotation is always 0", () => {
    const a = objectAt("a", "full", { x: 0, y: 0, width: 10, height: 10 });
    const b = objectAt("b", "full", { x: 20, y: 20, width: 10, height: 10 });
    const geometry = computeSelectionGeometry([a, b], registry(), 1)!;
    expect(geometry.bounds).toEqual({ x: 0, y: 0, width: 30, height: 30 });
    expect(geometry.rotation).toBe(0);
    expect(geometry.pivot).toEqual({ x: 15, y: 15 });
  });

  it("multi-object: any non-resizable member disables group resize entirely", () => {
    const a = objectAt("a", "full");
    const b = objectAt("b", "move-only", { x: 20, y: 20, width: 10, height: 10 });
    const geometry = computeSelectionGeometry([a, b], registry(), 1)!;
    expect(geometry.canResize).toBe(false);
    expect(geometry.canRotate).toBe(false);
  });
});

describe("hitTestHandle", () => {
  it("finds the closest handle within tolerance", () => {
    const object = objectAt("a", "full");
    const geometry = computeSelectionGeometry([object], registry(), 1)!;
    const hit = hitTestHandle(geometry, { x: 10.5, y: 10.5 }, 1);
    expect(hit?.id).toBe("se");
  });

  it("returns null outside tolerance", () => {
    const object = objectAt("a", "full");
    const geometry = computeSelectionGeometry([object], registry(), 1)!;
    expect(hitTestHandle(geometry, { x: 50, y: 50 }, 1)).toBeNull();
  });

  it("tolerance shrinks in world units as zoom increases", () => {
    const object = objectAt("a", "full");
    const geometry = computeSelectionGeometry([object], registry(), 1)!;
    // 6 world units away: within the default 8px/1x tolerance, but not within 8px/10x.
    expect(hitTestHandle(geometry, { x: 16, y: 10 }, 1)?.id).toBe("se");
    expect(hitTestHandle(geometry, { x: 16, y: 10 }, 10)).toBeNull();
  });
});
