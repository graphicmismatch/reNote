import { describe, expect, it } from "vitest";
import { identityTransform, newId, type PageObjectId } from "@renote/core";
import { boundsForStroke, type InkStrokeEngineObject } from "../objects/ink-stroke-object-type.js";
import type { ShapeObject } from "../objects/shape-object-type.js";
import { SceneGraph } from "../scene/scene-graph.js";
import { SelectionManager } from "../selection/selection-manager.js";
import type { NormalizedPointerEvent } from "../input/pointer-event.js";
import { LassoSelectTool } from "./lasso-select-tool.js";

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

function makeStroke(points: { x: number; y: number }[]): InkStrokeEngineObject {
  const strokePoints = points.map((p) => ({ ...p, pressure: 1 }));
  return {
    id: newId<PageObjectId>(),
    type: "ink-stroke",
    transform: identityTransform(),
    bounds: boundsForStroke(strokePoints, 2),
    data: { tool: "pen", color: "#000000", width: 2, pointDataAssetPath: "", points: strokePoints },
  };
}

function setUp() {
  const scene = new SceneGraph();
  const selection = new SelectionManager();
  const tool = new LassoSelectTool(scene, selection);
  return { scene, selection, tool };
}

/** Drags the lasso around a rectangular polygon by visiting each corner. */
function dragLassoRect(tool: LassoSelectTool, x: number, y: number, width: number, height: number): void {
  tool.onPointerDown(pointerEvent({ x, y }));
  tool.onPointerMove(pointerEvent({ x: x + width, y }));
  tool.onPointerMove(pointerEvent({ x: x + width, y: y + height }));
  tool.onPointerMove(pointerEvent({ x, y: y + height }));
  tool.onPointerUp(pointerEvent({ x, y }));
}

describe("LassoSelectTool", () => {
  it("selects an ink-stroke whose actual points fall inside the lasso polygon", () => {
    const { scene, selection, tool } = setUp();
    const stroke = makeStroke([
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]);
    scene.add(stroke);

    dragLassoRect(tool, 0, 0, 50, 50);

    expect(selection.selectedIds).toEqual([stroke.id]);
  });

  it(
    "does NOT select an L-shaped stroke whose bounding box overlaps the lasso but whose actual points don't, " +
      "even though a bounds-corner-only test would select it here",
    () => {
      const { scene, selection, tool } = setUp();
      // An L: (0,0) -> (0,100) -> (100,100). Its bounding box (padded by boundsForStroke) has a
      // corner near (101,-1) — the L's "missing" corner, (100,0), which the point path never
      // actually visits.
      const lStroke = makeStroke([
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ]);
      scene.add(lStroke);

      // Sanity: this lasso genuinely overlaps the stroke's bounds — it contains the bounds'
      // top-right corner (~101, -1) — so a bounds-corner-only implementation would select the
      // stroke here. Real ink-intersection must not.
      expect(lStroke.bounds.x + lStroke.bounds.width).toBeGreaterThan(80);
      expect(lStroke.bounds.y).toBeLessThan(15);
      dragLassoRect(tool, 80, -15, 40, 30); // covers (101, -1), covers no actual stroke point

      expect(selection.selectedIds).toEqual([]);
    },
  );

  it(
    "DOES select the same L-shaped stroke when the lasso covers one of its actual points " +
      "(proves the points-path is live, not just always returning false)",
    () => {
      const { scene, selection, tool } = setUp();
      const lStroke = makeStroke([
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ]);
      scene.add(lStroke);

      // Lasso around the actual point (0, 100), on the L's vertical arm.
      dragLassoRect(tool, -15, 85, 30, 30);

      expect(selection.selectedIds).toEqual([lStroke.id]);
    },
  );

  it("selects a non-ink object (e.g. a shape) using the bounds-corner fallback", () => {
    const { scene, selection, tool } = setUp();
    const shape: ShapeObject = {
      id: newId<PageObjectId>(),
      type: "shape",
      transform: identityTransform(),
      bounds: { x: 10, y: 10, width: 20, height: 20 },
      data: { kind: "rectangle", strokeColor: "#000000", strokeWidth: 2, fillColor: null },
    };
    scene.add(shape);

    dragLassoRect(tool, 0, 0, 50, 50);

    expect(selection.selectedIds).toEqual([shape.id]);
  });

  it("clears the selection on a single click (no meaningful drag) rather than selecting everything", () => {
    const { scene, selection, tool } = setUp();
    scene.add(
      makeStroke([
        { x: 5, y: 5 },
        { x: 6, y: 6 },
      ]),
    );
    selection.set(["preexisting" as PageObjectId]);

    tool.onPointerDown(pointerEvent({ x: 5, y: 5 }));
    tool.onPointerUp(pointerEvent({ x: 5.2, y: 5.1 })); // sub-threshold jitter, not a real drag

    expect(selection.selectedIds).toEqual([]);
  });
});
