import type { Bounds, PageObject, PageObjectId } from "@renote/core";
import { describe, expect, it } from "vitest";
import { ObjectTypeRegistry } from "../objects/registry.js";
import type { ObjectTypeDefinition } from "../objects/object-type-definition.js";
import { SceneGraph } from "./scene-graph.js";

function bounds(x: number, y: number, width: number, height: number): Bounds {
  return { x, y, width, height };
}

/** A "diamond" object type whose real hit area is the diamond inscribed in its bounds, not the
 * bounding box itself — a stand-in for e.g. an ink stroke's actual path vs. its bounding box. */
const diamondObjectType: ObjectTypeDefinition<"diamond", unknown> = {
  type: "diamond",
  validate: (data) => data,
  createView: () => {
    throw new Error("not exercised in this test");
  },
  updateView: () => {},
  hitTest: (object, point) => {
    const { x, y, width, height } = object.bounds;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const nx = Math.abs(point.x - cx) / (width / 2);
    const ny = Math.abs(point.y - cy) / (height / 2);
    return nx + ny <= 1;
  },
  supportsRotation: false,
  supportsResize: false,
};

function diamond(id: string, b: Bounds): PageObject<"diamond", unknown> {
  return {
    id: id as PageObjectId,
    type: "diamond",
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0 },
    bounds: b,
    data: {},
  };
}

describe("SceneGraph.clear", () => {
  it("removes every object and emits a 'removed' event per id", () => {
    const scene = new SceneGraph();
    scene.add(diamond("d1", bounds(0, 0, 10, 10)));
    scene.add(diamond("d2", bounds(20, 20, 10, 10)));

    const removed: PageObjectId[] = [];
    scene.events.on("removed", (id) => removed.push(id));

    scene.clear();

    expect(scene.all).toEqual([]);
    expect(removed.sort()).toEqual(["d1", "d2"]);
  });

  it("is a no-op on an already-empty scene", () => {
    const scene = new SceneGraph();
    expect(() => scene.clear()).not.toThrow();
    expect(scene.all).toEqual([]);
  });
});

describe("SceneGraph.hitTestPoint", () => {
  it("without an ObjectTypeRegistry, returns broad-phase (bounds-rect) matches", () => {
    const scene = new SceneGraph();
    scene.add(diamond("d1", bounds(0, 0, 10, 10)));

    // A corner of the bounding box, outside the diamond's actual hit area.
    expect(scene.hitTestPoint(1, 1)).toEqual(["d1"]);
  });

  it("with an ObjectTypeRegistry, narrows matches using the object's real hitTest", () => {
    const scene = new SceneGraph();
    scene.add(diamond("d1", bounds(0, 0, 10, 10)));
    const objectTypes = new ObjectTypeRegistry();
    objectTypes.register(diamondObjectType);

    // Corner of the bounding box: inside the broad-phase box, outside the diamond.
    expect(scene.hitTestPoint(1, 1, objectTypes)).toEqual([]);
    // Center: inside both.
    expect(scene.hitTestPoint(5, 5, objectTypes)).toEqual(["d1"]);
  });

  it("falls back to the broad-phase match when the object's type isn't registered", () => {
    const scene = new SceneGraph();
    scene.add(diamond("d1", bounds(0, 0, 10, 10)));
    const emptyRegistry = new ObjectTypeRegistry();

    expect(scene.hitTestPoint(1, 1, emptyRegistry)).toEqual(["d1"]);
  });
});
