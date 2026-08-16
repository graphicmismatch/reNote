import { describe, expect, it } from "vitest";
import { MeshSimple } from "pixi.js";
import { identityTransform, newId, type PageObjectId } from "@renote/core";
import {
  boundsForStroke,
  inkStrokeObjectType,
  type InkStrokeEngineObject,
} from "./ink-stroke-object-type.js";
import type { StrokePoint } from "../ink/stroke-point.js";

function makeStroke(
  points: StrokePoint[],
  width = 4,
  tool: "pen" | "highlighter" = "pen",
): InkStrokeEngineObject {
  return {
    id: newId<PageObjectId>(),
    type: "ink-stroke",
    transform: identityTransform(),
    bounds: boundsForStroke(points, width),
    data: { tool, color: "#112233", width, pointDataAssetPath: "", points },
  };
}

/** Barycentric-sign point-in-triangle test; matches how a GPU rasterizer decides coverage. */
function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const sign = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
    (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Whether any triangle in the mesh's tessellated geometry covers `point` — the actual rendered shape. */
function meshContainsPoint(mesh: MeshSimple, point: { x: number; y: number }): boolean {
  const positions = mesh.geometry.positions;
  const indices = mesh.geometry.indices;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!;
    const b = indices[i + 1]!;
    const c = indices[i + 2]!;
    if (
      pointInTriangle(
        point.x,
        point.y,
        positions[a * 2]!,
        positions[a * 2 + 1]!,
        positions[b * 2]!,
        positions[b * 2 + 1]!,
        positions[c * 2]!,
        positions[c * 2 + 1]!,
      )
    ) {
      return true;
    }
  }
  return false;
}

describe("inkStrokeObjectType", () => {
  it("hits a point near the polyline and misses a point far from it", () => {
    const stroke = makeStroke([
      { x: 0, y: 0, pressure: 1 },
      { x: 10, y: 0, pressure: 1 },
      { x: 20, y: 0, pressure: 1 },
    ]);

    expect(inkStrokeObjectType.hitTest(stroke, { x: 10, y: 1 })).toBe(true);
    expect(inkStrokeObjectType.hitTest(stroke, { x: 10, y: 100 })).toBe(false);
  });

  it("hits within threshold of a single-point stroke", () => {
    const stroke = makeStroke([{ x: 5, y: 5, pressure: 1 }], 6);
    expect(inkStrokeObjectType.hitTest(stroke, { x: 6, y: 6 })).toBe(true);
    expect(inkStrokeObjectType.hitTest(stroke, { x: 500, y: 500 })).toBe(false);
  });

  it("validates well-formed data and rejects malformed data", () => {
    const good = {
      tool: "pen",
      color: "#000000",
      width: 2,
      pointDataAssetPath: "",
      points: [{ x: 0, y: 0, pressure: 1 }],
    };
    expect(inkStrokeObjectType.validate(good)).toEqual(good);

    expect(() => inkStrokeObjectType.validate(null)).toThrow();
    expect(() => inkStrokeObjectType.validate({ ...good, tool: "marker" })).toThrow();
    expect(() => inkStrokeObjectType.validate({ ...good, points: "nope" })).toThrow();
  });

  it("computes a padded bounding box for a set of points", () => {
    const bounds = boundsForStroke(
      [
        { x: 0, y: 0, pressure: 1 },
        { x: 10, y: 5, pressure: 1 },
      ],
      4,
    );
    expect(bounds.x).toBeLessThan(0);
    expect(bounds.y).toBeLessThan(0);
    expect(bounds.width).toBeGreaterThan(10);
    expect(bounds.height).toBeGreaterThan(5);
  });

  it("createView/updateView run against a stroke without throwing (NullRenderer-style headless use)", () => {
    const stroke = makeStroke([
      { x: 0, y: 0, pressure: 0.3 },
      { x: 10, y: 10, pressure: 0.8 },
    ]);
    const view = inkStrokeObjectType.createView(stroke, { x: 0, y: 0 });
    expect(() => inkStrokeObjectType.updateView(view, stroke, { x: 0, y: 0 })).not.toThrow();
  });

  it("draws chunk-local geometry when given a non-zero origin, not raw world coordinates", () => {
    const stroke = makeStroke([
      { x: 1_000_000, y: 1_000_000, pressure: 1 },
      { x: 1_000_010, y: 1_000_010, pressure: 1 },
    ]);
    const origin = { x: 999_000, y: 999_000 };
    const view = inkStrokeObjectType.createView(stroke, origin) as MeshSimple;
    const bounds = view.getLocalBounds();

    // Chunk-local: near (1000, 1000), not (1_000_000, 1_000_000).
    expect(bounds.x).toBeGreaterThan(900);
    expect(bounds.x).toBeLessThan(1100);
    expect(bounds.y).toBeGreaterThan(900);
    expect(bounds.y).toBeLessThan(1100);
  });

  it("renders a pen stroke fully opaque and a highlighter stroke translucent as a single layer", () => {
    // Translucency must be a single alpha applied to the whole rendered mesh, not to each
    // individual triangle — per-triangle alpha would compound across every overlap in the
    // tessellation and end up looking opaque nearly everywhere.
    const points: StrokePoint[] = [
      { x: 0, y: 0, pressure: 1 },
      { x: 10, y: 10, pressure: 1 },
      { x: 20, y: 0, pressure: 1 },
    ];
    const penView = inkStrokeObjectType.createView(makeStroke(points, 4, "pen"), { x: 0, y: 0 });
    const highlighterView = inkStrokeObjectType.createView(makeStroke(points, 14, "highlighter"), {
      x: 0,
      y: 0,
    });

    expect(penView).toBeInstanceOf(MeshSimple);
    expect(highlighterView).toBeInstanceOf(MeshSimple);
    expect((penView as MeshSimple).alpha).toBe(1);
    expect((highlighterView as MeshSimple).alpha).toBe(0.4);
  });

  it("fills a tight self-crossing loop solid instead of punching a hole in it", () => {
    // A loop tighter than the stroke's own half-width makes perfect-freehand's outline
    // self-intersect (the outline hugs both sides of the path, and a loop that tight makes
    // those two sides cross). Physically, every point inside a loop this tight IS within
    // stroke-width of the path — the pen's ink genuinely covers it — so it must render solid.
    // (An earlier version of this fix used tess2's WINDING_ODD/evenodd rule, which instead
    // treats the self-crossing as canceling out to bare page — verified wrong by rendering an
    // ordinary X-crossing stroke and seeing a hole punched through the middle, which doesn't
    // happen with real ink. WINDING_NONZERO is the physically-correct rule: it unions all
    // covered area regardless of overlap count.)
    const width = 10;
    const loopRadius = 3; // well under width/2, guaranteeing outline self-intersection
    const points: StrokePoint[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      points.push({
        x: 50 + loopRadius * Math.cos(angle),
        y: 50 + loopRadius * Math.sin(angle),
        pressure: 1,
      });
    }
    const stroke = makeStroke(points, width);
    const view = inkStrokeObjectType.createView(stroke, { x: 0, y: 0 }) as MeshSimple;
    const { indices } = view.geometry;

    // Sanity check: the stroke actually tessellated into real geometry, not an empty mesh.
    expect(indices.length).toBeGreaterThan(0);

    // Center of a loop this tight is genuinely within stroke-width of the path — must be solid.
    expect(meshContainsPoint(view, { x: 50, y: 50 })).toBe(true);
  });

  it("leaves a genuinely large loop's center open — a real gap, not a fill-rule artifact", () => {
    // A loop with radius well beyond the stroke's half-width (like a normally-drawn "O") has a
    // center that is simply never within stroke-width of the path at any point — no ink ever
    // reaches it. This must stay open regardless of winding rule; it isn't a self-intersection
    // case at all (the outline's inner and outer offset curves don't cross for a loop this
    // size), so it's a distinct scenario from the tight-loop test above.
    const width = 4;
    const loopRadius = 30; // far beyond width/2 — a genuine, unreachable gap in the middle
    const points: StrokePoint[] = [];
    const steps = 32;
    for (let i = 0; i <= steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      points.push({
        x: 50 + loopRadius * Math.cos(angle),
        y: 50 + loopRadius * Math.sin(angle),
        pressure: 1,
      });
    }
    const stroke = makeStroke(points, width);
    const view = inkStrokeObjectType.createView(stroke, { x: 0, y: 0 }) as MeshSimple;

    expect(view.geometry.indices.length).toBeGreaterThan(0);
    // Center of the loop: genuinely unreached by the stroke, must stay open.
    expect(meshContainsPoint(view, { x: 50, y: 50 })).toBe(false);
    // On the loop's own path: must be filled (it's the actual stroke).
    expect(meshContainsPoint(view, { x: 50 + loopRadius, y: 50 })).toBe(true);
  });

  it("fills the crossing point of a plain self-intersecting stroke (e.g. a scribbled X)", () => {
    // Two straight segments of the same stroke crossing each other — no loop, just a path that
    // doubles back over itself. The crossing is real ink-on-ink overlap and must render solid,
    // the same way two overlapping pen strokes look like solid ink on paper, not a gap.
    const width = 10;
    const points: StrokePoint[] = [];
    for (let i = 0; i <= 10; i += 1) {
      const t = i / 10;
      points.push({ x: 20 + t * 40, y: 20 + t * 40, pressure: 1 });
    }
    for (let i = 0; i <= 10; i += 1) {
      const t = i / 10;
      points.push({ x: 60 - t * 40, y: 20 + t * 40, pressure: 1 });
    }
    const stroke = makeStroke(points, width);
    const view = inkStrokeObjectType.createView(stroke, { x: 0, y: 0 }) as MeshSimple;

    expect(view.geometry.indices.length).toBeGreaterThan(0);
    // The crossing point of the two diagonals: must be filled solid.
    expect(meshContainsPoint(view, { x: 40, y: 40 })).toBe(true);
  });
});
