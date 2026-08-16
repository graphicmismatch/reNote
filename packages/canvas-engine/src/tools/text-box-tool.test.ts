import { EventBus } from "@renote/core";
import { describe, expect, it } from "vitest";
import { CommandStack } from "../commands/command-stack.js";
import type { TextBoxObject } from "../objects/text-box-object-type.js";
import { SceneGraph } from "../scene/scene-graph.js";
import type { NormalizedPointerEvent } from "../input/pointer-event.js";
import type { PageEngineEvents, TextEditBeginPayload } from "../text-edit-events.js";
import { TextBoxTool } from "./text-box-tool.js";

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

function setUp() {
  const scene = new SceneGraph();
  const commands = new CommandStack(scene);
  const textEditEvents = new EventBus<PageEngineEvents>();
  const tool = new TextBoxTool(scene, commands, textEditEvents);
  return { scene, commands, textEditEvents, tool };
}

describe("TextBoxTool", () => {
  it("registers under the text-box id and commits a text-box object with bounds from the drag", () => {
    const { scene, commands, tool } = setUp();
    expect(tool.id).toBe("text-box");

    tool.onPointerDown(pointerEvent({ x: 10, y: 20 }));
    tool.onPointerMove(pointerEvent({ x: 110, y: 60 }));
    tool.onPointerUp(pointerEvent({ x: 110, y: 60 }));

    const boxes = scene.all.filter((o) => o.type === "text-box") as TextBoxObject[];
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.bounds).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    expect(commands.canUndo).toBe(true);
  });

  it("places a default-sized box on a plain click (no meaningful drag)", () => {
    const { scene, tool } = setUp();
    tool.onPointerDown(pointerEvent({ x: 5, y: 5 }));
    tool.onPointerUp(pointerEvent({ x: 5, y: 5 }));

    const boxes = scene.all.filter((o) => o.type === "text-box") as TextBoxObject[];
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.bounds.x).toBe(5);
    expect(boxes[0]!.bounds.y).toBe(5);
    expect(boxes[0]!.bounds.width).toBeGreaterThan(0);
    expect(boxes[0]!.bounds.height).toBeGreaterThan(0);
  });

  it("emits text-edit:begin for the newly placed box so it drops straight into editing", () => {
    const { textEditEvents, tool } = setUp();
    let payload: TextEditBeginPayload | null = null;
    textEditEvents.on("text-edit:begin", (event) => {
      payload = event;
    });

    tool.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    tool.onPointerUp(pointerEvent({ x: 0, y: 0 }));

    expect(payload).not.toBeNull();
  });

  it("does not leave a live-preview object behind after commit", () => {
    const { scene, tool } = setUp();
    tool.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    tool.onPointerMove(pointerEvent({ x: 30, y: 30 }));
    expect(scene.all).toHaveLength(1); // live preview only
    tool.onPointerUp(pointerEvent({ x: 30, y: 30 }));
    expect(scene.all).toHaveLength(1); // replaced by the single committed object
  });

  it("discards the in-progress text box on cancel", () => {
    const { scene, commands, tool } = setUp();
    tool.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    tool.onPointerMove(pointerEvent({ x: 30, y: 30 }));
    tool.onCancel();
    expect(scene.all).toHaveLength(0);
    expect(commands.canUndo).toBe(false);
  });
});
