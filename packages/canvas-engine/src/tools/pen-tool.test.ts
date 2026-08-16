import { describe, expect, it } from "vitest";
import { identityTransform, newId, type PageObjectId } from "@renote/core";
import { PageEngine } from "../PageEngine.js";
import { NullRenderer } from "../render/null-renderer.js";
import { registerBuiltInObjectTypes, registerBuiltInTools } from "../register-built-ins.js";
import { CommandStack } from "../commands/command-stack.js";
import { AddObjectCommand } from "../commands/object-commands.js";
import { SceneGraph } from "../scene/scene-graph.js";
import type { NormalizedPointerEvent } from "../input/pointer-event.js";
import { boundsForStroke, type InkStrokeEngineObject } from "../objects/ink-stroke-object-type.js";
import type { ShapeObject } from "../objects/shape-object-type.js";
import { PenTool } from "./pen-tool.js";
import type { Tool } from "./tool.js";

function pointerEvent(overrides: Partial<NormalizedPointerEvent> = {}): NormalizedPointerEvent {
  return {
    pointerId: 1,
    source: "pen",
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

function setUpEngine(): PageEngine {
  const engine = new PageEngine(new NullRenderer());
  registerBuiltInObjectTypes(engine);
  registerBuiltInTools(engine);
  engine.tools.activate("pen");
  return engine;
}

describe("PenTool", () => {
  it("commits a smoothed, undoable ink-stroke object on a full pointer down/move/up gesture", () => {
    const engine = setUpEngine();
    const pen = engine.tools.active!;

    pen.onPointerDown(pointerEvent({ x: 0, y: 0, pressure: 0.4 }));
    pen.onPointerMove(pointerEvent({ x: 10, y: 10, pressure: 0.6 }));
    pen.onPointerMove(pointerEvent({ x: 20, y: 0, pressure: 0.8 }));
    pen.onPointerUp(pointerEvent({ x: 20, y: 0, pressure: 0.8 }));

    const strokes = engine.scene.all.filter((object) => object.type === "ink-stroke");
    expect(strokes).toHaveLength(1);

    const stroke = strokes[0] as InkStrokeEngineObject;
    // smoothStroke fans 3 raw points out into many more via Catmull-Rom sampling.
    expect(stroke.data.points.length).toBeGreaterThan(3);
    expect(stroke.data.tool).toBe("pen");

    expect(engine.commands.canUndo).toBe(true);
    engine.commands.undo();
    expect(engine.scene.all.filter((object) => object.type === "ink-stroke")).toHaveLength(0);
    expect(engine.commands.canUndo).toBe(false);

    engine.commands.redo();
    expect(engine.scene.all.filter((object) => object.type === "ink-stroke")).toHaveLength(1);
  });

  it("updates a live-preview object on pointer move that disappears once the final stroke commits", () => {
    const engine = setUpEngine();
    const pen = engine.tools.active!;

    pen.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    expect(engine.scene.all.filter((object) => object.type === "ink-stroke")).toHaveLength(1);
    // The live preview must never be reachable via undo — it was never executed as a command.
    expect(engine.commands.canUndo).toBe(false);

    pen.onPointerMove(pointerEvent({ x: 5, y: 5 }));
    pen.onPointerMove(pointerEvent({ x: 10, y: 0 }));
    expect(engine.scene.all.filter((object) => object.type === "ink-stroke")).toHaveLength(1);
    expect(engine.commands.canUndo).toBe(false);

    pen.onPointerUp(pointerEvent({ x: 10, y: 0 }));
    // Exactly one ink-stroke remains: the live preview was removed and replaced by the
    // committed object, they never coexist.
    expect(engine.scene.all.filter((object) => object.type === "ink-stroke")).toHaveLength(1);
    expect(engine.commands.canUndo).toBe(true);
  });

  it("discards the in-progress stroke and leaves no trace on onCancel", () => {
    const engine = setUpEngine();
    const pen = engine.tools.active!;

    pen.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    pen.onPointerMove(pointerEvent({ x: 5, y: 5 }));
    pen.onCancel();

    expect(engine.scene.all).toHaveLength(0);
    expect(engine.commands.canUndo).toBe(false);
  });

  it("ignores eraser-flagged pointer-down (a separate eraser tool owns that gesture)", () => {
    const engine = setUpEngine();
    const pen = engine.tools.active!;

    pen.onPointerDown(pointerEvent({ x: 0, y: 0, isEraser: true }));
    pen.onPointerMove(pointerEvent({ x: 5, y: 5, isEraser: true }));
    pen.onPointerUp(pointerEvent({ x: 5, y: 5, isEraser: true }));

    expect(engine.scene.all).toHaveLength(0);
  });

  it("bakes the live inkSettings color into each committed stroke at commit time, and undo/redo preserve each stroke's own color rather than repainting in the current color", () => {
    const engine = setUpEngine();
    const pen = engine.tools.active!;

    engine.inkSettings.setColor("pen", "#ff0000");
    pen.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    pen.onPointerMove(pointerEvent({ x: 10, y: 10 }));
    pen.onPointerUp(pointerEvent({ x: 10, y: 10 }));

    engine.inkSettings.setColor("pen", "#0000ff");
    pen.onPointerDown(pointerEvent({ x: 20, y: 20 }));
    pen.onPointerMove(pointerEvent({ x: 30, y: 30 }));
    pen.onPointerUp(pointerEvent({ x: 30, y: 30 }));

    const strokes = engine.scene.all.filter(
      (object) => object.type === "ink-stroke",
    ) as InkStrokeEngineObject[];
    expect(strokes).toHaveLength(2);
    expect(strokes[0]!.data.color).toBe("#ff0000");
    expect(strokes[1]!.data.color).toBe("#0000ff");

    // A later color change must not repaint already-committed strokes retroactively.
    engine.inkSettings.setColor("pen", "#00ff00");
    expect(
      (engine.scene.all.filter((o) => o.type === "ink-stroke") as InkStrokeEngineObject[]).map(
        (s) => s.data.color,
      ),
    ).toEqual(["#ff0000", "#0000ff"]);

    engine.commands.undo();
    engine.commands.undo();
    engine.commands.redo();
    engine.commands.redo();
    const afterRoundTrip = engine.scene.all.filter(
      (object) => object.type === "ink-stroke",
    ) as InkStrokeEngineObject[];
    expect(afterRoundTrip.map((s) => s.data.color)).toEqual(["#ff0000", "#0000ff"]);
  });

  it("the highlighter never shares the pen's color, and switching tools doesn't cross-contaminate settings", () => {
    const engine = setUpEngine();

    engine.inkSettings.setColor("pen", "#123456");
    engine.tools.activate("highlighter");
    expect(engine.inkSettings.get("highlighter")!.color).toBe("#ffe066");

    engine.inkSettings.setColor("highlighter", "#abcdef");
    engine.tools.activate("pen");
    expect(engine.inkSettings.get("pen")!.color).toBe("#123456");
  });
});

describe("highlighter (a second PenTool instance, not a duplicate class)", () => {
  it("registers under a distinct tool id and commits a highlighter-tagged ink-stroke", () => {
    const engine = new PageEngine(new NullRenderer());
    registerBuiltInObjectTypes(engine);
    registerBuiltInTools(engine);

    expect(engine.tools.registeredToolIds).toContain("pen");
    expect(engine.tools.registeredToolIds).toContain("highlighter");

    engine.tools.activate("highlighter");
    const highlighter = engine.tools.active!;
    expect(highlighter.id).toBe("highlighter");
    expect(highlighter.id).not.toBe("pen");

    highlighter.onPointerDown(pointerEvent({ x: 0, y: 0 }));
    highlighter.onPointerMove(pointerEvent({ x: 10, y: 10 }));
    highlighter.onPointerUp(pointerEvent({ x: 10, y: 10 }));

    const strokes = engine.scene.all.filter(
      (object) => object.type === "ink-stroke",
    ) as InkStrokeEngineObject[];
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.data.tool).toBe("highlighter");
  });
});

describe("PenTool recognizeShapes option (opt-in ink-to-shape recognition)", () => {
  // A dense rectangle-perimeter path: enough raw samples per edge that the Catmull-Rom
  // smoothing in commitStroke doesn't round the corners away (verified empirically).
  function rectanglePathEvents(): { x: number; y: number }[] {
    const corners: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 60],
      [0, 60],
      [0, 0],
    ];
    const events: { x: number; y: number }[] = [];
    for (let edge = 0; edge < corners.length - 1; edge += 1) {
      const [ax, ay] = corners[edge]!;
      const [bx, by] = corners[edge + 1]!;
      for (let i = 0; i < 12; i += 1) {
        const t = i / 12;
        events.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
      }
    }
    events.push({ x: 0, y: 0 });
    return events;
  }

  function drawGesture(tool: PenTool, points: { x: number; y: number }[]): void {
    tool.onPointerDown(pointerEvent(points[0]!));
    for (const point of points.slice(1, -1)) {
      tool.onPointerMove(pointerEvent(point));
    }
    tool.onPointerUp(pointerEvent(points[points.length - 1]!));
  }

  it("commits a shape object (not an ink-stroke) for recognizable input when recognizeShapes is true", () => {
    const scene = new SceneGraph();
    const commands = new CommandStack(scene);
    const pen = new PenTool(scene, commands, { recognizeShapes: true });

    drawGesture(pen, rectanglePathEvents());

    expect(scene.all.filter((o) => o.type === "shape")).toHaveLength(1);
    expect(scene.all.filter((o) => o.type === "ink-stroke")).toHaveLength(0);
    const shape = scene.all.find((o) => o.type === "shape") as ShapeObject;
    expect(shape.data.kind).toBe("rectangle");
    expect(commands.canUndo).toBe(true);
  });

  it("still commits an ink-stroke for the same input when recognizeShapes is not set (default false)", () => {
    const scene = new SceneGraph();
    const commands = new CommandStack(scene);
    const pen = new PenTool(scene, commands);

    drawGesture(pen, rectanglePathEvents());

    expect(scene.all.filter((o) => o.type === "ink-stroke")).toHaveLength(1);
    expect(scene.all.filter((o) => o.type === "shape")).toHaveLength(0);
  });

  it("recognizeShapesRef overrides the static option live, without recreating the tool", () => {
    const scene = new SceneGraph();
    const commands = new CommandStack(scene);
    const ref = { current: false };
    const pen = new PenTool(scene, commands, { recognizeShapesRef: ref });

    drawGesture(pen, rectanglePathEvents());
    expect(scene.all.filter((o) => o.type === "ink-stroke")).toHaveLength(1);
    expect(scene.all.filter((o) => o.type === "shape")).toHaveLength(0);

    ref.current = true;
    drawGesture(pen, rectanglePathEvents());
    expect(scene.all.filter((o) => o.type === "shape")).toHaveLength(1);
  });
});

describe("PenTool scratch-out erase gesture (Phase 10.2)", () => {
  /** Thin horizontal target the gesture below is guaranteed to stay within `data.width`'s hit
   *  tolerance of at every sample, regardless of exactly where each zigzag leg crosses it. */
  function crossingTarget(): InkStrokeEngineObject {
    const points = [
      { x: 0, y: 0, pressure: 1 },
      { x: 50, y: 0, pressure: 1 },
    ];
    return {
      id: newId<PageObjectId>(),
      type: "ink-stroke",
      transform: identityTransform(),
      bounds: boundsForStroke(points, 12),
      data: { tool: "pen", color: "#000000", width: 12, pointDataAssetPath: "", points },
    };
  }

  /** A thin, many-reversal zigzag whose whole y-range stays within the target's hit tolerance
   *  and whose x-range sits inside the target's span. */
  function scratchOutEvents(): { x: number; y: number }[] {
    const steps = 8;
    const events: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i += 1) {
      events.push({ x: 5 + (i / steps) * 40, y: i % 2 === 0 ? -5 : 5 });
    }
    return events;
  }

  function drawGesture(tool: Tool, points: { x: number; y: number }[]): void {
    tool.onPointerDown(pointerEvent(points[0]!));
    for (const point of points.slice(1, -1)) {
      tool.onPointerMove(pointerEvent(point));
    }
    tool.onPointerUp(pointerEvent(points[points.length - 1]!));
  }

  it("deletes every object it crosses in one undoable step, instead of committing ink", () => {
    const engine = setUpEngine();
    const target = crossingTarget();
    engine.commands.execute(new AddObjectCommand(target));
    expect(engine.scene.all).toHaveLength(1);

    drawGesture(engine.tools.active!, scratchOutEvents());

    expect(engine.scene.get(target.id)).toBeUndefined();
    expect(engine.scene.all).toHaveLength(0);
    expect(engine.commands.canUndo).toBe(true);

    engine.commands.undo();
    expect(engine.scene.get(target.id)).toEqual(target);
  });

  it("commits as ordinary ink when the same zigzag shape doesn't overlap anything", () => {
    const engine = setUpEngine();

    drawGesture(engine.tools.active!, scratchOutEvents());

    expect(engine.scene.all.filter((o) => o.type === "ink-stroke")).toHaveLength(1);
  });
});
