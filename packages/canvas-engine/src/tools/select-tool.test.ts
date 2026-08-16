import { describe, expect, it } from "vitest";
import { EventBus, identityTransform, newId, type PageObjectId } from "@renote/core";
import { CommandStack } from "../commands/command-stack.js";
import { ObjectTypeRegistry } from "../objects/registry.js";
import { shapeObjectType } from "../objects/shape-object-type.js";
import { textBoxObjectType } from "../objects/text-box-object-type.js";
import { inkStrokeObjectType } from "../objects/ink-stroke-object-type.js";
import { SceneGraph } from "../scene/scene-graph.js";
import { SelectionManager } from "../selection/selection-manager.js";
import type { PageEngineEvents, TextEditBeginPayload, TextEditEndPayload } from "../text-edit-events.js";
import type { NormalizedPointerEvent } from "../input/pointer-event.js";
import { SelectTool } from "./select-tool.js";

function pointerEvent(
  x: number,
  y: number,
  overrides: Partial<NormalizedPointerEvent> = {},
): NormalizedPointerEvent {
  return {
    pointerId: 1,
    source: "mouse",
    x,
    y,
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

function registry(): ObjectTypeRegistry {
  const registry = new ObjectTypeRegistry();
  registry.register(textBoxObjectType);
  registry.register(shapeObjectType);
  registry.register(inkStrokeObjectType);
  return registry;
}

function setUp(zoom = 1) {
  const scene = new SceneGraph();
  const selection = new SelectionManager();
  const commands = new CommandStack(scene);
  const events = new EventBus<PageEngineEvents>();
  const objectTypes = registry();
  const tool = new SelectTool(scene, selection, commands, objectTypes, () => zoom, events);

  const textBoxId = newId<PageObjectId>();
  scene.add({
    id: textBoxId,
    type: "text-box",
    transform: identityTransform(),
    bounds: { x: 0, y: 0, width: 50, height: 50 },
    data: { content: "" },
  });

  const shapeId = newId<PageObjectId>();
  scene.add({
    id: shapeId,
    type: "shape",
    transform: identityTransform(),
    bounds: { x: 100, y: 100, width: 20, height: 20 },
    data: { kind: "rectangle", strokeColor: "#000", strokeWidth: 1, fillColor: null },
  });

  return { scene, selection, commands, events, tool, textBoxId, shapeId };
}

describe("SelectTool: click selection (unchanged v1 behavior)", () => {
  it("selects the top hit object on pointer down and clears selection on empty space", () => {
    const { tool, selection, textBoxId } = setUp();

    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerUp(pointerEvent(10, 10));
    expect(selection.selectedIds).toEqual([textBoxId]);

    tool.onPointerDown(pointerEvent(1000, 1000));
    tool.onPointerUp(pointerEvent(1000, 1000));
    expect(selection.selectedIds).toEqual([]);
  });

  it("emits text-edit:begin on a double-click of a text-box object", () => {
    const { tool, events, textBoxId } = setUp();
    const begins: TextEditBeginPayload[] = [];
    events.on("text-edit:begin", (payload) => begins.push(payload));

    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerUp(pointerEvent(10, 10));
    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerUp(pointerEvent(10, 10));

    expect(begins).toHaveLength(1);
    expect(begins[0]).toEqual({
      objectId: textBoxId,
      worldBounds: { x: 0, y: 0, width: 50, height: 50 },
      rotation: 0,
    });
  });

  it("positions text-edit:begin's worldBounds at the object's current (moved) location, not where it was originally placed", () => {
    const { tool, events, textBoxId } = setUp();
    const begins: TextEditBeginPayload[] = [];
    events.on("text-edit:begin", (payload) => begins.push(payload));

    const originalNow = Date.now;
    let now = 0;
    Date.now = () => now;
    try {
      // Drag the box from its original (0,0)-(50,50) position by +100,+100, so it now sits at
      // (100,100)-(150,150).
      tool.onPointerDown(pointerEvent(10, 10));
      tool.onPointerMove(pointerEvent(110, 110));
      tool.onPointerUp(pointerEvent(110, 110));

      // Well past the double-click window, so the drag's initial pointerDown above doesn't
      // count as the first half of the double-click below. Clicks land at (125,125), the
      // moved box's center — its corners now double as resize-handle hit zones since the drag
      // above left it selected, and a corner click would grab a handle instead of the object.
      now += 1000;
      tool.onPointerDown(pointerEvent(125, 125)); // hits the box at its NEW, moved location
      tool.onPointerUp(pointerEvent(125, 125));
      now += 50;
      tool.onPointerDown(pointerEvent(125, 125));
      tool.onPointerUp(pointerEvent(125, 125));

      expect(begins).toHaveLength(1);
      // `bounds` itself stays {0,0,50,50} — local, pre-transform space, per Transform2D's own
      // doc comment — but the DOM overlay must be positioned at the object's actual, moved
      // world location: (100,100)-(150,150).
      expect(begins[0]).toEqual({
        objectId: textBoxId,
        worldBounds: { x: 100, y: 100, width: 50, height: 50 },
        rotation: 0,
      });
    } finally {
      Date.now = originalNow;
    }
  });

  it("passes the object's rotation through text-edit:begin, and worldBounds reflects a resized (scaled) box", () => {
    const { scene, tool, events, textBoxId } = setUp();
    const begins: TextEditBeginPayload[] = [];
    events.on("text-edit:begin", (payload) => begins.push(payload));

    // Simulates the box having been resized (transform.scaleX/scaleY, per applyScale — resize
    // never touches `bounds` itself) and rotated by 90 degrees via the select-tool handles,
    // before the user double-clicks to edit it.
    const original = scene.get(textBoxId)!;
    scene.update({
      ...original,
      transform: { ...original.transform, scaleX: 2, scaleY: 3, rotation: Math.PI / 2 },
    });

    tool.onPointerDown(pointerEvent(25, 25));
    tool.onPointerUp(pointerEvent(25, 25));
    tool.onPointerDown(pointerEvent(25, 25));
    tool.onPointerUp(pointerEvent(25, 25));

    expect(begins).toHaveLength(1);
    expect(begins[0]?.rotation).toBe(Math.PI / 2);
    // A 90-degree rotation swaps which local axis maps to world width/height: the box's own
    // local size is 50x50, scaled to 100x150 (scaleX=2, scaleY=3) — after a quarter turn, that
    // scaled rectangle's axis-aligned bounding box is 150 wide x 100 tall, not 100x150.
    expect(begins[0]?.worldBounds.width).toBeCloseTo(150);
    expect(begins[0]?.worldBounds.height).toBeCloseTo(100);
  });

  it("emits text-edit:end when clicking away from a text box being edited", () => {
    const { tool, events, textBoxId } = setUp();
    const ends: TextEditEndPayload[] = [];
    events.on("text-edit:end", (payload) => ends.push(payload));

    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerUp(pointerEvent(10, 10));
    tool.onPointerDown(pointerEvent(10, 10)); // double click -> begin editing
    tool.onPointerUp(pointerEvent(10, 10));
    tool.onPointerDown(pointerEvent(1000, 1000)); // click away -> end editing
    tool.onPointerUp(pointerEvent(1000, 1000));

    expect(ends).toHaveLength(1);
    expect(ends[0]).toEqual({ objectId: textBoxId });
  });

  it("emits text-edit:end on Escape (onCancel) while editing", () => {
    const { tool, events, textBoxId } = setUp();
    const ends: TextEditEndPayload[] = [];
    events.on("text-edit:end", (payload) => ends.push(payload));

    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerUp(pointerEvent(10, 10));
    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerUp(pointerEvent(10, 10));
    tool.onCancel();

    expect(ends).toHaveLength(1);
    expect(ends[0]).toEqual({ objectId: textBoxId });
  });

  it("clears its own editing state when text-edit:end is emitted by something else entirely, so a later double-click reopens the same object", () => {
    const { tool, events, textBoxId } = setUp();
    const begins: TextEditBeginPayload[] = [];
    events.on("text-edit:begin", (payload) => begins.push(payload));

    const originalNow = Date.now;
    let now = 0;
    Date.now = () => now;
    try {
      tool.onPointerDown(pointerEvent(10, 10));
      tool.onPointerUp(pointerEvent(10, 10));
      now += 50;
      tool.onPointerDown(pointerEvent(10, 10)); // double click -> begin editing
      tool.onPointerUp(pointerEvent(10, 10));
      expect(begins).toHaveLength(1);

      // Simulates apps/desktop's PageEditorView ending the edit in response to a UI action
      // outside the canvas entirely (e.g. clicking Settings) — this never goes through
      // SelectTool at all, it's emitted straight onto the shared bus.
      events.emit("text-edit:end", { objectId: textBoxId });

      // Well past the double-click window, so this is unambiguously a fresh double-click pair,
      // not a continuation of the one above.
      now += 1000;
      tool.onPointerDown(pointerEvent(10, 10));
      tool.onPointerUp(pointerEvent(10, 10));
      now += 50;
      tool.onPointerDown(pointerEvent(10, 10));
      tool.onPointerUp(pointerEvent(10, 10));

      // Without SelectTool listening for that emission itself, its internal editingObjectId
      // would still equal textBoxId here, and this fresh double-click would silently no-op.
      expect(begins).toHaveLength(2);
    } finally {
      Date.now = originalNow;
    }
  });

  it("does not treat two separate single clicks far apart in time as a double-click", () => {
    const { tool, events } = setUp();
    const begins: TextEditBeginPayload[] = [];
    events.on("text-edit:begin", (payload) => begins.push(payload));

    const originalNow = Date.now;
    let now = 0;
    Date.now = () => now;
    try {
      tool.onPointerDown(pointerEvent(10, 10));
      tool.onPointerUp(pointerEvent(10, 10));
      now += 1000; // well beyond the double-click window
      tool.onPointerDown(pointerEvent(10, 10));
      tool.onPointerUp(pointerEvent(10, 10));
    } finally {
      Date.now = originalNow;
    }

    expect(begins).toHaveLength(0);
  });
});

describe("SelectTool: shift-click multi-select", () => {
  it("adds to and removes from the selection instead of replacing it", () => {
    const { tool, selection, textBoxId, shapeId } = setUp();

    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerUp(pointerEvent(10, 10));
    expect(selection.selectedIds).toEqual([textBoxId]);

    tool.onPointerDown(pointerEvent(110, 110, { shiftKey: true }));
    tool.onPointerUp(pointerEvent(110, 110, { shiftKey: true }));
    expect(selection.selectedIds).toEqual([textBoxId, shapeId]);

    tool.onPointerDown(pointerEvent(10, 10, { shiftKey: true }));
    tool.onPointerUp(pointerEvent(10, 10, { shiftKey: true }));
    expect(selection.selectedIds).toEqual([shapeId]);
  });

  it("shift-clicking empty space leaves the selection untouched", () => {
    const { tool, selection, textBoxId } = setUp();
    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerUp(pointerEvent(10, 10));
    tool.onPointerDown(pointerEvent(1000, 1000, { shiftKey: true }));
    tool.onPointerUp(pointerEvent(1000, 1000, { shiftKey: true }));
    expect(selection.selectedIds).toEqual([textBoxId]);
  });
});

describe("SelectTool: move", () => {
  it("drags a selected object and commits one undoable transform change", () => {
    const { tool, scene, commands, textBoxId } = setUp();

    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerMove(pointerEvent(30, 25));
    tool.onPointerUp(pointerEvent(30, 25));

    const moved = scene.get(textBoxId)!;
    expect(moved.transform.x).toBeCloseTo(20);
    expect(moved.transform.y).toBeCloseTo(15);
    // bounds/data stay in local space — only transform carries the move.
    expect(moved.bounds).toEqual({ x: 0, y: 0, width: 50, height: 50 });

    expect(commands.canUndo).toBe(true);
    commands.undo();
    const reverted = scene.get(textBoxId)!;
    expect(reverted.transform.x).toBe(0);
    expect(reverted.transform.y).toBe(0);
  });

  it("moves every member of a multi-selection together in one undo step", () => {
    const { tool, scene, commands, textBoxId, shapeId } = setUp();
    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerUp(pointerEvent(10, 10));
    tool.onPointerDown(pointerEvent(110, 110, { shiftKey: true }));
    tool.onPointerUp(pointerEvent(110, 110, { shiftKey: true }));

    const beforeUndoCount = commands.history.length;
    tool.onPointerDown(pointerEvent(110, 110));
    tool.onPointerMove(pointerEvent(120, 130));
    tool.onPointerUp(pointerEvent(120, 130));

    expect(scene.get(textBoxId)!.transform).toMatchObject({ x: 10, y: 20 });
    expect(scene.get(shapeId)!.transform).toMatchObject({ x: 10, y: 20 });
    expect(commands.history.length).toBe(beforeUndoCount + 1);

    commands.undo();
    expect(scene.get(textBoxId)!.transform.x).toBe(0);
    expect(scene.get(shapeId)!.transform.x).toBe(0);
  });

  it("a click with no real movement commits no command", () => {
    const { tool, commands } = setUp();
    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerUp(pointerEvent(10, 10));
    expect(commands.history).toHaveLength(0);
  });

  it("Escape mid-drag reverts the live preview without leaving an undo entry", () => {
    const { tool, scene, commands, textBoxId } = setUp();
    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerMove(pointerEvent(50, 50));
    tool.onCancel();

    expect(scene.get(textBoxId)!.transform).toEqual(identityTransform());
    expect(commands.history).toHaveLength(0);
  });
});

describe("SelectTool: rotate", () => {
  it("rotates a single selected object around its own center, leaving its position unchanged", () => {
    const { tool, scene, textBoxId } = setUp();
    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerUp(pointerEvent(10, 10));

    // The 50x50 box's pivot is (25, 25); its rotate handle sits 24 world units above the top
    // edge, i.e. (25, -24) — 49 units above the pivot. Dragging from there to the point exactly
    // 90 degrees further around the pivot at the same radius (74, 25) is an exact quarter-turn.
    tool.onPointerDown(pointerEvent(25, -24));
    tool.onPointerMove(pointerEvent(74, 25));
    tool.onPointerUp(pointerEvent(74, 25));

    const rotated = scene.get(textBoxId)!;
    expect(rotated.transform.rotation).toBeCloseTo(Math.PI / 2);
    expect(rotated.transform.x).toBeCloseTo(0);
    expect(rotated.transform.y).toBeCloseTo(0);
  });

  it("a type with supportsRotation=false never grants a rotate gesture — clicking it always moves", () => {
    const { tool, scene, selection } = setUp();
    const strokeId = newId<PageObjectId>();
    scene.add({
      id: strokeId,
      type: "ink-stroke",
      transform: identityTransform(),
      bounds: { x: 200, y: 200, width: 10, height: 10 },
      data: {
        tool: "pen",
        color: "#000",
        width: 2,
        pointDataAssetPath: "",
        points: [
          { x: 200, y: 200, pressure: 1 },
          { x: 205, y: 205, pressure: 1 },
        ],
      },
    });
    selection.set([strokeId]);

    tool.onPointerDown(pointerEvent(205, 205));
    tool.onPointerMove(pointerEvent(215, 205));
    tool.onPointerUp(pointerEvent(215, 205));

    const result = scene.get(strokeId)!;
    expect(result.transform.rotation).toBe(0);
    expect(result.transform.x).toBeCloseTo(10);
  });
});

describe("SelectTool: scale", () => {
  it("drags a corner handle to uniformly scale a single object around its center", () => {
    const { tool, scene, textBoxId } = setUp();
    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerUp(pointerEvent(10, 10));

    // se handle of the 50x50 box (0,0)-(50,50) sits at (50, 50); double the distance from
    // center (25,25) -> (75, 75) doubles the scale.
    tool.onPointerDown(pointerEvent(50, 50));
    tool.onPointerMove(pointerEvent(75, 75));
    tool.onPointerUp(pointerEvent(75, 75));

    const scaled = scene.get(textBoxId)!;
    expect(scaled.transform.scaleX).toBeCloseTo(2);
    expect(scaled.transform.scaleY).toBeCloseTo(2);
    // Center-anchored: the object's world center (25,25) stays put.
    const localCenter = { x: 25, y: 25 };
    expect(localCenter.x + scaled.transform.x).toBeCloseTo(25);
    expect(localCenter.y + scaled.transform.y).toBeCloseTo(25);
  });

  it("dragging an edge handle scales only that axis", () => {
    const { tool, scene, textBoxId } = setUp();
    tool.onPointerDown(pointerEvent(10, 10));
    tool.onPointerUp(pointerEvent(10, 10));

    // e handle sits at (50, 25); push it out to (100, 25) -> scaleX only.
    tool.onPointerDown(pointerEvent(50, 25));
    tool.onPointerMove(pointerEvent(100, 25));
    tool.onPointerUp(pointerEvent(100, 25));

    const scaled = scene.get(textBoxId)!;
    expect(scaled.transform.scaleX).toBeCloseTo(3);
    expect(scaled.transform.scaleY).toBeCloseTo(1);
  });

  it("a type with supportsResize=false never grants a scale gesture — dragging its own body moves it", () => {
    const { tool, scene, selection, commands } = setUp();
    const strokeId = newId<PageObjectId>();
    scene.add({
      id: strokeId,
      type: "ink-stroke",
      transform: identityTransform(),
      bounds: { x: 200, y: 200, width: 10, height: 10 },
      data: {
        tool: "pen",
        color: "#000",
        width: 2,
        pointDataAssetPath: "",
        points: [
          { x: 200, y: 200, pressure: 1 },
          { x: 210, y: 210, pressure: 1 },
        ],
      },
    });
    selection.set([strokeId]);

    tool.onPointerDown(pointerEvent(210, 210));
    tool.onPointerMove(pointerEvent(300, 300));
    tool.onPointerUp(pointerEvent(300, 300));

    const moved = scene.get(strokeId)!;
    expect(moved.transform.scaleX).toBe(1);
    expect(moved.transform.x).not.toBe(0);
    expect(commands.history).toHaveLength(1);
  });
});
