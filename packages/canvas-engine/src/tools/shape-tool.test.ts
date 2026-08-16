import { describe, expect, it } from "vitest";
import { CommandStack } from "../commands/command-stack.js";
import type { ShapeObject } from "../objects/shape-object-type.js";
import { SceneGraph } from "../scene/scene-graph.js";
import type { NormalizedPointerEvent } from "../input/pointer-event.js";
import { ShapeTool } from "./shape-tool.js";

function pointerEvent(overrides: Partial<NormalizedPointerEvent> = {}): NormalizedPointerEvent {
  return {
    pointerId: 1,
    source: "mouse",
    x: 0,
    y: 0,
    pressure: 1,
    tiltX: 0,
    tiltY: 0,
    isEraser: false,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  };
}

function setUp(kind: "rectangle" | "ellipse" | "line" | "arrow") {
  const scene = new SceneGraph();
  const commands = new CommandStack(scene);
  const tool = new ShapeTool(scene, commands, kind);
  return { scene, commands, tool };
}

describe("ShapeTool", () => {
  it("registers under a shape-<kind> id and commits a shape object with bounds from the drag", () => {
    const { scene, commands, tool } = setUp("rectangle");
    expect(tool.id).toBe("shape-rectangle");

    tool.onPointerDown(pointerEvent({ x: 10, y: 20 }));
    tool.onPointerMove(pointerEvent({ x: 60, y: 50 }));
    tool.onPointerUp(pointerEvent({ x: 60, y: 50 }));

    const shapes = scene.all.filter((o) => o.type === "shape") as ShapeObject[];
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.data.kind).toBe("rectangle");
    expect(shapes[0]!.bounds).toEqual({ x: 10, y: 20, width: 50, height: 30 });
    expect(commands.canUndo).toBe(true);
  });

  it("does not leave a live-preview object behind after commit", () => {
    const { scene, tool } = setUp("ellipse");
    tool.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    tool.onPointerMove(pointerEvent({ x: 30, y: 30 }));
    expect(scene.all).toHaveLength(1); // live preview only
    tool.onPointerUp(pointerEvent({ x: 30, y: 30 }));
    expect(scene.all).toHaveLength(1); // replaced by the single committed object
  });

  it("discards the in-progress shape on cancel", () => {
    const { scene, commands, tool } = setUp("rectangle");
    tool.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    tool.onPointerMove(pointerEvent({ x: 30, y: 30 }));
    tool.onCancel();

    expect(scene.all).toHaveLength(0);
    expect(commands.canUndo).toBe(false);
  });

  it("square-aspect-snaps rectangle/ellipse drags when shiftKey is held, producing different bounds than the unsnapped drag", () => {
    const unsnapped = setUp("rectangle");
    unsnapped.tool.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    unsnapped.tool.onPointerUp(pointerEvent({ x: 100, y: 20, shiftKey: false }));
    const unsnappedShape = unsnapped.scene.all.find((o) => o.type === "shape") as ShapeObject;
    expect(unsnappedShape.bounds).toEqual({ x: 0, y: 0, width: 100, height: 20 });

    const snapped = setUp("rectangle");
    snapped.tool.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    snapped.tool.onPointerUp(pointerEvent({ x: 100, y: 20, shiftKey: true }));
    const snappedShape = snapped.scene.all.find((o) => o.type === "shape") as ShapeObject;

    // Same drag coordinates, only shiftKey differs -> snapping forces a 1:1 aspect using the
    // larger delta (100), so width and height both become 100, unlike the unsnapped 100x20.
    expect(snappedShape.bounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(snappedShape.bounds).not.toEqual(unsnappedShape.bounds);
  });

  it("preserves the actual drag direction for a line, not just the bounds diagonal", () => {
    // Drag from bottom-left to top-right: bounds alone (top-left/bottom-right corners) would
    // reconstruct this as running top-left-to-bottom-right instead — the opposite direction.
    const { scene, tool } = setUp("line");
    tool.onPointerDown(pointerEvent({ x: 0, y: 50 }));
    tool.onPointerUp(pointerEvent({ x: 50, y: 0 }));

    const shape = scene.all.find((o) => o.type === "shape") as ShapeObject;
    expect(shape.bounds).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    expect(shape.data.startPoint).toEqual({ x: 0, y: 50 });
    expect(shape.data.endPoint).toEqual({ x: 50, y: 0 });
  });

  it("angle-snaps a line/arrow endpoint to the nearest 15-degree increment when shiftKey is held", () => {
    const unsnapped = setUp("line");
    unsnapped.tool.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    // A drag at ~10 degrees from horizontal (close to, but not exactly, the 15-degree grid).
    unsnapped.tool.onPointerUp(pointerEvent({ x: 100, y: 17.6, shiftKey: false }));
    const unsnappedShape = unsnapped.scene.all.find((o) => o.type === "shape") as ShapeObject;

    const snapped = setUp("line");
    snapped.tool.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    snapped.tool.onPointerUp(pointerEvent({ x: 100, y: 17.6, shiftKey: true }));
    const snappedShape = snapped.scene.all.find((o) => o.type === "shape") as ShapeObject;

    expect(snappedShape.bounds).not.toEqual(unsnappedShape.bounds);
    // Snapped to 15 degrees at the same drag length: height = length * sin(15deg).
    const length = Math.hypot(100, 17.6);
    const expectedHeight = length * Math.sin((15 * Math.PI) / 180);
    expect(snappedShape.bounds.height).toBeCloseTo(expectedHeight, 3);
  });
});
