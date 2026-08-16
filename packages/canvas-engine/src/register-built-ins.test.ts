import { identityTransform, newId, type PageObjectId } from "@renote/core";
import { describe, expect, it } from "vitest";
import { boundsForStroke, type InkStrokeEngineObject } from "./objects/ink-stroke-object-type.js";
import { PageEngine } from "./PageEngine.js";
import { NullRenderer } from "./render/null-renderer.js";
import {
  convertInkStrokeToShape,
  createTextBox,
  registerBuiltInObjectTypes,
  registerBuiltInTools,
  straightenInkStroke,
} from "./register-built-ins.js";
import { InkSettingsRegistry } from "./tools/ink-settings.js";

describe("registerBuiltInObjectTypes", () => {
  it("registers ink-stroke and text-box, and only after being called", () => {
    const engine = new PageEngine(new NullRenderer());
    expect(engine.objectTypes.has("ink-stroke")).toBe(false);
    expect(engine.objectTypes.has("text-box")).toBe(false);

    registerBuiltInObjectTypes(engine);

    expect(engine.objectTypes.has("ink-stroke")).toBe(true);
    expect(engine.objectTypes.has("text-box")).toBe(true);
  });
});

describe("registerBuiltInTools", () => {
  it("registers select and pen tools without activating either", () => {
    const engine = new PageEngine(new NullRenderer());
    registerBuiltInTools(engine);

    expect(engine.tools.registeredToolIds).toContain("select");
    expect(engine.tools.registeredToolIds).toContain("pen");
    expect(engine.tools.active).toBeNull();
  });

  it("seeds every color/size-bearing tool id into engine.inkSettings", () => {
    const engine = new PageEngine(new NullRenderer());
    registerBuiltInTools(engine);

    for (const toolId of ["pen", "highlighter", "stroke-eraser", "pixel-eraser", "shape-rectangle"]) {
      expect(engine.inkSettings.get(toolId)).toBeDefined();
    }
  });

  it("a user-chosen color survives a PageEngine remount when the same inkSettings instance is reused — the real apps/desktop page-switch scenario", () => {
    const sharedInkSettings = new InkSettingsRegistry();

    const firstPageEngine = new PageEngine(new NullRenderer(), sharedInkSettings);
    registerBuiltInTools(firstPageEngine);
    firstPageEngine.inkSettings.setColor("pen", "#ff00ff");

    // Simulates PageEditorView remounting a fresh PageEngine on page switch, passing the
    // same shared registry back in.
    const secondPageEngine = new PageEngine(new NullRenderer(), sharedInkSettings);
    registerBuiltInTools(secondPageEngine);

    expect(secondPageEngine.inkSettings.get("pen")!.color).toBe("#ff00ff");
  });
});

/** Builds a committed-looking ink-stroke object from plain page-space points, for the
 *  Convert-to-Shape/Straighten-Stroke helpers below (which operate on already-committed
 *  objects, unlike PenTool's own live-drawing path). */
function inkStroke(points: { x: number; y: number }[], width = 2): InkStrokeEngineObject {
  const pts = points.map((p) => ({ x: p.x, y: p.y, pressure: 1 }));
  return {
    id: newId<PageObjectId>(),
    type: "ink-stroke",
    transform: identityTransform(),
    bounds: boundsForStroke(pts, width),
    data: { tool: "pen", color: "#ff0000", width, pointDataAssetPath: "", points: pts },
  };
}

function rectanglePoints(x: number, y: number, width: number, height: number, perEdge = 12) {
  const corners: [number, number][] = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
    [x, y],
  ];
  const points: { x: number; y: number }[] = [];
  for (let edge = 0; edge < corners.length - 1; edge += 1) {
    const [ax, ay] = corners[edge]!;
    const [bx, by] = corners[edge + 1]!;
    for (let i = 0; i < perEdge; i += 1) {
      const t = i / perEdge;
      points.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
    }
  }
  points.push({ x, y });
  return points;
}

describe("convertInkStrokeToShape", () => {
  it("converts a rectangle-perimeter stroke into a shape carrying the stroke's own color/width", () => {
    const stroke = inkStroke(rectanglePoints(0, 0, 100, 60), 4);
    const shape = convertInkStrokeToShape(stroke);

    expect(shape).not.toBeNull();
    expect(shape!.type).toBe("shape");
    expect(shape!.data.kind).toBe("rectangle");
    expect(shape!.data.strokeColor).toBe("#ff0000");
    expect(shape!.data.strokeWidth).toBe(4);
    expect(shape!.transform).toEqual(stroke.transform);
    expect(shape!.id).not.toBe(stroke.id);
  });

  it("returns null for a stroke that doesn't recognize as any shape", () => {
    const stroke = inkStroke([
      { x: 0, y: 0 },
      { x: 15, y: 40 },
      { x: 5, y: 10 },
      { x: 50, y: 60 },
      { x: 10, y: 5 },
    ]);
    expect(convertInkStrokeToShape(stroke)).toBeNull();
  });
});

describe("straightenInkStroke", () => {
  it("snaps a near-straight stroke's points onto its chord and recomputes bounds", () => {
    const points = Array.from({ length: 21 }, (_, i) => ({
      x: i * 5,
      y: i % 2 === 0 ? 0 : 0.4,
    }));
    const stroke = inkStroke(points, 6);

    const result = straightenInkStroke(stroke);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(stroke.id);
    expect(result!.data.color).toBe("#ff0000");
    expect(result!.data.width).toBe(6);
    expect(result!.data.points).toHaveLength(2);
    expect(result!.data.points[0]!.x).toBeCloseTo(0, 0);
    expect(result!.data.points[1]!.x).toBeCloseTo(100, 0);
    expect(result!.bounds).toEqual(boundsForStroke(result!.data.points, 6));
  });

  it("returns null for a stroke that isn't near-collinear", () => {
    const stroke = inkStroke(rectanglePoints(0, 0, 100, 60));
    expect(straightenInkStroke(stroke)).toBeNull();
  });
});

describe("createTextBox", () => {
  it("creates an undoable text-box object at the given bounds", () => {
    const engine = new PageEngine(new NullRenderer());
    registerBuiltInObjectTypes(engine);

    const id = createTextBox(engine, { x: 5, y: 5, width: 120, height: 40 }, { text: "hi" });

    const object = engine.scene.get(id);
    expect(object?.type).toBe("text-box");
    expect(object?.bounds).toEqual({ x: 5, y: 5, width: 120, height: 40 });
    expect(engine.commands.canUndo).toBe(true);

    engine.commands.undo();
    expect(engine.scene.get(id)).toBeUndefined();
  });
});
