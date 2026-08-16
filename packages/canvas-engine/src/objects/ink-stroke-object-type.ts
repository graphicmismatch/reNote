import { MeshSimple, Texture } from "pixi.js";
import type { Container } from "pixi.js";
import { getStroke } from "perfect-freehand";
import Tess2 from "tess2";
import type { InkStrokeData, PageObject } from "@renote/core";
import type { StrokePoint } from "../ink/stroke-point.js";
import { distanceToSegment } from "./geometry.js";
import type { ChunkOrigin, ObjectTypeDefinition } from "./object-type-definition.js";

/**
 * `InkStrokeData.pointDataAssetPath` is a *persistence* concern — a relative path to a
 * binary blob under the page's assets/strokes folder, owned by `renote-storage`. There is
 * no storage wiring in canvas-engine yet, so at this phase the actual point geometry lives
 * only in memory. Chosen representation: extend the persisted `InkStrokeData` shape with an
 * engine-internal `points` array carried directly on the `PageObject`'s `data`, rather than a
 * side `Map<PageObjectId, StrokePoint[]>`. This keeps the object self-contained (undo/redo just
 * swaps whole `data` objects, no parallel map to keep in sync) at the cost of `points` being
 * absent from what would actually get serialized by storage later (storage would read
 * `pointDataAssetPath`, load the blob, and populate `points` itself — out of scope here).
 */
export interface InkStrokeEngineData extends InkStrokeData {
  /** Smoothed stroke points in page/world space (same space as `NormalizedPointerEvent.x/y`). */
  points: StrokePoint[];
}

export type InkStrokeEngineObject = PageObject<"ink-stroke", InkStrokeEngineData>;

function isStrokePoint(value: unknown): value is StrokePoint {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.x === "number" &&
    typeof candidate.y === "number" &&
    typeof candidate.pressure === "number"
  );
}

function validateInkStrokeData(data: unknown): InkStrokeEngineData {
  if (typeof data !== "object" || data === null) {
    throw new Error("ink-stroke data must be an object.");
  }
  const candidate = data as Record<string, unknown>;
  if (candidate.tool !== "pen" && candidate.tool !== "highlighter") {
    throw new Error('ink-stroke data.tool must be "pen" or "highlighter".');
  }
  if (typeof candidate.color !== "string") {
    throw new Error("ink-stroke data.color must be a string.");
  }
  if (typeof candidate.width !== "number") {
    throw new Error("ink-stroke data.width must be a number.");
  }
  if (typeof candidate.pointDataAssetPath !== "string") {
    throw new Error("ink-stroke data.pointDataAssetPath must be a string.");
  }
  if (!Array.isArray(candidate.points) || !candidate.points.every(isStrokePoint)) {
    throw new Error("ink-stroke data.points must be an array of {x,y,pressure}.");
  }
  return {
    tool: candidate.tool,
    color: candidate.color,
    width: candidate.width,
    pointDataAssetPath: candidate.pointDataAssetPath,
    points: candidate.points as StrokePoint[],
  };
}

/**
 * `getStroke`'s options for turning a smoothed point array into a single outline polygon.
 * `streamline: 0` because the points arriving here are already Catmull-Rom-smoothed and
 * densely sampled (see catmull-rom.ts) — perfect-freehand's own streamline exists to
 * stabilize *raw, live* pointer input, which isn't what this function receives.
 * `simulatePressure: false` because every `StrokePoint` already carries a real (or
 * hardware-defaulted) pressure value; letting the library simulate its own velocity-based
 * pressure would discard that.
 */
const STROKE_OUTLINE_OPTIONS = {
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0,
  simulatePressure: false,
  last: true,
} as const;

/** Number of segments used to approximate a single tap/dot as a circle contour before tessellation. */
const DOT_CONTOUR_SEGMENTS = 16;

/**
 * `getStroke`'s outline hugs both sides of the input path, so a tight loop (the path crossing
 * itself, or curving back within less than a stroke-width of itself — e.g. a cursive "e" or a
 * fast scribbled loop) makes the outline self-intersect. Filling a self-intersecting polygon
 * with Pixi's normal `Graphics.poly().fill()` is undefined behavior: Pixi's WebGL/WebGPU
 * Graphics tessellates fills with earcut, which implements neither standard fill rule
 * (nonzero or evenodd) for self-intersecting input — confirmed via pixijs/pixijs#11752 — and in
 * practice fills areas that were never actually within the stroke's swept width, which is the
 * bug this works around.
 *
 * The winding rule matters and it is NOT evenodd: physically, ink from a stroke that crosses
 * itself (a tight loop, or any self-intersecting path) covers the crossing — two overlapping
 * passes of the same pen don't cancel each other back out to bare paper. Evenodd does exactly
 * that cancellation (confirmed by rendering: it left a visible hole punched through an ordinary
 * X-crossing stroke, and hollowed the round end caps of a plain stroke into rings), which is
 * wrong. Nonzero is the correct rule — it unions all covered area regardless of overlap count,
 * matching physical ink coverage: a self-crossing/tight-loop area renders solid, matching a
 * from-scratch Chrome `CanvasRenderingContext2D.fill(path, "nonzero")` reference render of the
 * same outline, while a loop large enough that its center is simply never within stroke-width
 * of the path (e.g. a normally-sized "O")
 * still renders with a real hole — because that hole is genuine empty distance, not something
 * the fill rule creates or removes. `tess2` (a JS port of libtess2/the GLU tesselator) computes
 * this correctly for self-intersecting input, so the stroke is tessellated with it directly into
 * a flat triangle list and rendered as a `MeshSimple` instead of a `Graphics.poly()` fill.
 *
 * `origin` is the chunk-local offset (Phase 5.6, floating-origin rendering): every point is
 * offset by `-origin.x`/`-origin.y` before tessellation, so the Pixi vertex buffer only ever
 * holds small, chunk-local values regardless of how far from (0,0) the stroke actually lives in
 * world space — the `Container` this mesh sits in carries the large offset back via its own
 * `.position` (see PixiRenderer).
 */
/**
 * Pixi's WebGL draw path picks the index GL type purely from the typed array's
 * `BYTES_PER_ELEMENT` — 2 bytes means `UNSIGNED_SHORT`, anything else means `UNSIGNED_INT`
 * (see `GlGeometrySystem`'s draw method). `UNSIGNED_INT` indices need WebGL2 or the
 * `OES_element_index_uint` extension; on a WebGL1 context without it, the `drawElements` call
 * fails silently — no thrown error, nothing rendered. Confirmed live: this exact failure mode
 * reproduces on this machine's real WebKitGTK-based Tauri WebView (Graphics-based shapes render
 * fine there; every `Uint32Array`-indexed ink-stroke mesh silently didn't), while headless
 * Chrome's WebGL implementation always has the extension and hid the bug completely. A
 * `Uint16Array` works on every WebGL1 context unconditionally, so use one whenever the vertex
 * count fits (virtually always, for a single stroke) and only fall back to `Uint32Array` for a
 * pathologically long stroke that would otherwise wrap/corrupt 16-bit indices. `MeshGeometry`
 * itself just stores whatever typed array it's given and reads `BYTES_PER_ELEMENT` back off of
 * it — its `Uint32Array`-only setter type doesn't reflect that, hence the cast.
 */
const MAX_UINT16_INDEXABLE_VERTICES = 65_536;

function toIndexBuffer(elements: readonly number[], vertexCount: number): Uint32Array {
  if (vertexCount <= MAX_UINT16_INDEXABLE_VERTICES) {
    return new Uint16Array(elements) as unknown as Uint32Array;
  }
  return new Uint32Array(elements);
}

function updateStrokeMesh(mesh: MeshSimple, object: InkStrokeEngineObject, origin: ChunkOrigin): void {
  const { points, color, width } = object.data;
  mesh.tint = color;
  mesh.alpha = object.data.tool === "highlighter" ? 0.4 : 1;

  let outline: readonly (readonly [number, number])[];
  if (points.length === 0) {
    outline = [];
  } else if (points.length === 1) {
    const only = points[0]!;
    const radius = Math.max(0.5, (width * only.pressure) / 2);
    const cx = only.x - origin.x;
    const cy = only.y - origin.y;
    outline = Array.from({ length: DOT_CONTOUR_SEGMENTS }, (_, i) => {
      const angle = (i / DOT_CONTOUR_SEGMENTS) * Math.PI * 2;
      return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as const;
    });
  } else {
    outline = getStroke(
      points.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y, pressure: p.pressure })),
      { ...STROKE_OUTLINE_OPTIONS, size: width },
    );
  }

  if (outline.length === 0) {
    mesh.geometry.positions = new Float32Array(0);
    mesh.geometry.uvs = new Float32Array(0);
    mesh.geometry.indices = toIndexBuffer([], 0);
    return;
  }

  const { vertices, elements } = Tess2.tesselate({
    contours: [outline.flat() as number[]],
    windingRule: Tess2.WINDING_NONZERO,
    elementType: Tess2.POLYGONS,
    polySize: 3,
    vertexSize: 2,
  });
  mesh.geometry.positions = new Float32Array(vertices);
  // MeshGeometry's own docs: "its important that the uvs array is at least as long as the
  // positions array... otherwise the geometry will not be valid." We paint a solid color via
  // `Texture.WHITE` + `tint`, so the actual UV values are irrelevant — only the buffer length
  // matters. Zeros the same length as `vertices` (2 floats/vertex, matching `positions`)
  // keeps the attribute buffers in sync; without this, positions grows on every update but
  // uvs stays whatever length it was at construction (0), which some WebGL implementations
  // reject outright — confirmed live: this exact mismatch silently dropped every ink-stroke
  // draw call on this machine's WebKitGTK-based Tauri WebView while Chrome tolerated it.
  mesh.geometry.uvs = new Float32Array(vertices.length);
  mesh.geometry.indices = toIndexBuffer(elements, vertices.length / 2);
}

function createStrokeMesh(): MeshSimple {
  return new MeshSimple({
    texture: Texture.WHITE,
    vertices: new Float32Array(0),
    indices: toIndexBuffer([], 0),
  });
}

export const inkStrokeObjectType: ObjectTypeDefinition<"ink-stroke", InkStrokeEngineData> = {
  type: "ink-stroke",

  validate: validateInkStrokeData,

  createView(object, origin): Container {
    const mesh = createStrokeMesh();
    updateStrokeMesh(mesh, object, origin);
    return mesh;
  },

  updateView(view, object, origin): void {
    if (view instanceof MeshSimple) {
      updateStrokeMesh(view, object, origin);
    }
  },

  hitTest(object, point): boolean {
    const { points, width } = object.data;
    const threshold = Math.max(2, width);
    if (points.length === 1) {
      return Math.hypot(point.x - points[0]!.x, point.y - points[0]!.y) <= threshold;
    }
    for (let i = 0; i < points.length - 1; i += 1) {
      if (distanceToSegment(point, points[i]!, points[i + 1]!) <= threshold) {
        return true;
      }
    }
    return false;
  },

  supportsRotation: false,
  supportsResize: false,
};

/** Computes a page-space bounding box for a set of stroke points, padded by half the stroke width. */
export function boundsForStroke(
  points: readonly StrokePoint[],
  width: number,
): { x: number; y: number; width: number; height: number } {
  const pad = Math.max(1, width / 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}
