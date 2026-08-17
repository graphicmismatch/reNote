import { describe, expect, it } from "vitest";
import { identityTransform, newId, type PageObjectId } from "@renote/core";
import { CommandStack } from "../commands/command-stack.js";
import { boundsForStroke, type InkStrokeEngineObject } from "../objects/ink-stroke-object-type.js";
import { SceneGraph } from "../scene/scene-graph.js";
import type { NormalizedPointerEvent } from "../input/pointer-event.js";
import { PixelEraserTool } from "./pixel-eraser-tool.js";

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

/** A long horizontal stroke sampled at every integer x from 0..100, all at y=0. */
function makeLongHorizontalStroke(): InkStrokeEngineObject {
  const points = Array.from({ length: 101 }, (_, i) => ({ x: i, y: 0, pressure: 1 }));
  return {
    id: newId<PageObjectId>(),
    type: "ink-stroke",
    transform: identityTransform(),
    bounds: boundsForStroke(points, 2),
    data: { tool: "pen", color: "#000000", width: 2, pointDataAssetPath: "", points },
  };
}

function setUp(radius = 5) {
  const scene = new SceneGraph();
  const commands = new CommandStack(scene);
  const tool = new PixelEraserTool(scene, commands, { radius });
  return { scene, commands, tool };
}

describe("PixelEraserTool", () => {
  it("trims points near one end of a stroke to a single surviving run (no split), as one undo entry", () => {
    const { scene, commands, tool } = setUp();
    const stroke = makeLongHorizontalStroke();
    scene.add(stroke);

    // Erase near x=0..10, leaving one contiguous run: x=~16..100.
    tool.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    tool.onPointerUp(pointerEvent({ x: 10, y: 0 }));

    expect(commands.history).toHaveLength(1);
    const remaining = scene.all.filter((o) => o.type === "ink-stroke");
    expect(remaining).toHaveLength(1);
    const updated = remaining[0] as InkStrokeEngineObject;
    expect(updated.data.points.length).toBeLessThan(101);
    expect(updated.data.points.every((p) => p.x > 10)).toBe(true);

    commands.undo();
    const restored = scene.get(stroke.id) as InkStrokeEngineObject;
    expect(restored.data.points).toHaveLength(101);
  });

  it("splits a stroke into two new objects when erasing a gap in the middle, as one undo entry", () => {
    const { scene, commands, tool } = setUp();
    const stroke = makeLongHorizontalStroke();
    scene.add(stroke);

    // Erase near x=45..55, in the middle -> two surviving runs.
    tool.onPointerDown(pointerEvent({ x: 45, y: 0 }));
    tool.onPointerUp(pointerEvent({ x: 55, y: 0 }));

    expect(commands.history).toHaveLength(1);
    expect(scene.get(stroke.id)).toBeUndefined(); // original removed

    const remainingStrokes = scene.all.filter((o) => o.type === "ink-stroke") as InkStrokeEngineObject[];
    expect(remainingStrokes).toHaveLength(2);
    const [first, second] = remainingStrokes.sort((a, b) => a.data.points[0]!.x - b.data.points[0]!.x);
    expect(first!.data.points.every((p) => p.x < 45)).toBe(true);
    expect(second!.data.points.every((p) => p.x > 55)).toBe(true);

    commands.undo();
    expect(scene.get(stroke.id)).toBeDefined();
    expect(scene.all.filter((o) => o.type === "ink-stroke")).toHaveLength(1);
  });

  it("removes the whole stroke when every point falls within the erase radius", () => {
    const { scene, commands, tool } = setUp(10);
    const stroke = makeLongHorizontalStroke();
    scene.add(stroke);

    // Drag the whole length of the stroke with a radius wide enough to cover it end to end.
    tool.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    for (let x = 10; x <= 100; x += 10) {
      tool.onPointerMove(pointerEvent({ x, y: 0 }));
    }
    tool.onPointerUp(pointerEvent({ x: 100, y: 0 }));

    expect(scene.get(stroke.id)).toBeUndefined();
    expect(scene.all.filter((o) => o.type === "ink-stroke")).toHaveLength(0);
    expect(commands.history).toHaveLength(1);
  });

  it("does nothing when the eraser path never comes near a stroke", () => {
    const { scene, commands, tool } = setUp();
    scene.add(makeLongHorizontalStroke());

    tool.onPointerDown(pointerEvent({ x: 0, y: 500 }));
    tool.onPointerUp(pointerEvent({ x: 10, y: 500 }));

    expect(commands.history).toHaveLength(0);
    expect(scene.all.filter((o) => o.type === "ink-stroke")).toHaveLength(1);
  });

  it("trims points live, before the gesture is finished, with nothing on the undo stack yet", () => {
    const { scene, commands, tool } = setUp();
    const stroke = makeLongHorizontalStroke();
    scene.add(stroke);

    tool.onPointerDown(pointerEvent({ x: 0, y: 0 }));

    const live = scene.get(stroke.id) as InkStrokeEngineObject;
    expect(live.data.points.length).toBeLessThan(101);
    expect(commands.history).toHaveLength(0);
  });

  it("reverts the live preview on cancel, leaving the scene untouched", () => {
    const { scene, commands, tool } = setUp();
    const stroke = makeLongHorizontalStroke();
    scene.add(stroke);

    tool.onPointerDown(pointerEvent({ x: 45, y: 0 })); // would split mid-stroke
    tool.onPointerMove(pointerEvent({ x: 55, y: 0 }));
    tool.onCancel();

    const restored = scene.get(stroke.id) as InkStrokeEngineObject;
    expect(restored.data.points).toHaveLength(101);
    expect(scene.all.filter((o) => o.type === "ink-stroke")).toHaveLength(1);
    expect(commands.history).toHaveLength(0);
  });
});
