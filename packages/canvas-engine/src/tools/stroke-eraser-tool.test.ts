import { describe, expect, it } from "vitest";
import { identityTransform, newId, type PageObjectId } from "@renote/core";
import { CommandStack } from "../commands/command-stack.js";
import {
  boundsForStroke,
  inkStrokeObjectType,
  type InkStrokeEngineObject,
} from "../objects/ink-stroke-object-type.js";
import { ObjectTypeRegistry } from "../objects/registry.js";
import { SceneGraph } from "../scene/scene-graph.js";
import type { NormalizedPointerEvent } from "../input/pointer-event.js";
import { StrokeEraserTool } from "./stroke-eraser-tool.js";

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

function makeHorizontalStroke(y: number, x0: number, x1: number): InkStrokeEngineObject {
  const points = [
    { x: x0, y, pressure: 1 },
    { x: x1, y, pressure: 1 },
  ];
  return {
    id: newId<PageObjectId>(),
    type: "ink-stroke",
    transform: identityTransform(),
    bounds: boundsForStroke(points, 4),
    data: { tool: "pen", color: "#000000", width: 4, pointDataAssetPath: "", points },
  };
}

function setUp() {
  const scene = new SceneGraph();
  const commands = new CommandStack(scene);
  const objectTypes = new ObjectTypeRegistry();
  objectTypes.register(inkStrokeObjectType);
  const tool = new StrokeEraserTool(scene, commands, objectTypes);
  return { scene, commands, tool };
}

describe("StrokeEraserTool", () => {
  it("removes 2+ whole strokes touched in one drag as exactly one undo entry, and undo restores all of them", () => {
    const { scene, commands, tool } = setUp();
    const strokeA = makeHorizontalStroke(0, 0, 20);
    const strokeB = makeHorizontalStroke(0, 40, 60);
    const strokeC = makeHorizontalStroke(0, 80, 100); // not touched by the drag below
    scene.add(strokeA);
    scene.add(strokeB);
    scene.add(strokeC);

    tool.onPointerDown(pointerEvent({ x: 10, y: 0 })); // touches strokeA
    tool.onPointerMove(pointerEvent({ x: 50, y: 0 })); // touches strokeB
    tool.onPointerUp(pointerEvent({ x: 50, y: 0 }));

    expect(scene.get(strokeA.id)).toBeUndefined();
    expect(scene.get(strokeB.id)).toBeUndefined();
    expect(scene.get(strokeC.id)).toBeDefined();
    expect(commands.history).toHaveLength(1);

    commands.undo();
    expect(scene.get(strokeA.id)).toBeDefined();
    expect(scene.get(strokeB.id)).toBeDefined();
    expect(scene.get(strokeC.id)).toBeDefined();
  });

  it("does not re-queue an object already touched earlier in the same gesture", () => {
    const { scene, commands, tool } = setUp();
    const stroke = makeHorizontalStroke(0, 0, 100);
    scene.add(stroke);

    tool.onPointerDown(pointerEvent({ x: 10, y: 0 }));
    tool.onPointerMove(pointerEvent({ x: 20, y: 0 })); // still over the same stroke
    tool.onPointerMove(pointerEvent({ x: 30, y: 0 }));
    tool.onPointerUp(pointerEvent({ x: 40, y: 0 }));

    expect(scene.get(stroke.id)).toBeUndefined();
    // One stroke removed -> one sub-command -> still exactly one history entry, not several.
    expect(commands.history).toHaveLength(1);
  });

  it("does nothing (no history entry) when the drag never touches an object", () => {
    const { scene, commands, tool } = setUp();
    scene.add(makeHorizontalStroke(0, 0, 20));

    tool.onPointerDown(pointerEvent({ x: 500, y: 500 }));
    tool.onPointerUp(pointerEvent({ x: 500, y: 500 }));

    expect(commands.history).toHaveLength(0);
  });

  it("hides a touched stroke immediately, before the gesture is finished", () => {
    const { scene, tool } = setUp();
    const stroke = makeHorizontalStroke(0, 0, 20);
    scene.add(stroke);

    tool.onPointerDown(pointerEvent({ x: 10, y: 0 }));

    expect(scene.get(stroke.id)).toBeUndefined();
  });

  it("restores live-hidden strokes on cancel", () => {
    const { scene, commands, tool } = setUp();
    const stroke = makeHorizontalStroke(0, 0, 20);
    scene.add(stroke);

    tool.onPointerDown(pointerEvent({ x: 10, y: 0 }));
    expect(scene.get(stroke.id)).toBeUndefined();

    tool.onCancel();

    expect(scene.get(stroke.id)).toBeDefined();
    expect(commands.history).toHaveLength(0);
  });
});
