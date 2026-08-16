import { Graphics } from "pixi.js";
import type { Container } from "pixi.js";
import type { ShapeData, ShapeObject } from "@renote/core";
import { distanceToSegment } from "./geometry.js";
import type { ChunkOrigin, ObjectTypeDefinition } from "./object-type-definition.js";

// Re-exported so callers can `import { ShapeObject } from "@renote/canvas-engine"` without also
// reaching into "@renote/core" — same pattern as text-box-object-type.ts's re-export, since
// ShapeObject/ShapeData carry no engine-only fields (unlike ink-stroke's engine-widened data).
export type { ShapeObject, ShapeData };

const DEFAULT_STROKE_COLOR = "#000000";
const ARROWHEAD_LENGTH = 12;
const ARROWHEAD_ANGLE = Math.PI / 7;

function validateShapeData(data: unknown): ShapeData {
  if (typeof data !== "object" || data === null) {
    throw new Error("shape data must be an object.");
  }
  const candidate = data as Record<string, unknown>;
  if (
    candidate.kind !== "rectangle" &&
    candidate.kind !== "ellipse" &&
    candidate.kind !== "line" &&
    candidate.kind !== "arrow"
  ) {
    throw new Error('shape data.kind must be one of "rectangle" | "ellipse" | "line" | "arrow".');
  }
  if (typeof candidate.strokeColor !== "string") {
    throw new Error("shape data.strokeColor must be a string.");
  }
  if (typeof candidate.strokeWidth !== "number") {
    throw new Error("shape data.strokeWidth must be a number.");
  }
  if (candidate.fillColor !== null && typeof candidate.fillColor !== "string") {
    throw new Error("shape data.fillColor must be a string or null.");
  }
  return {
    kind: candidate.kind,
    strokeColor: candidate.strokeColor,
    strokeWidth: candidate.strokeWidth,
    fillColor: candidate.fillColor as string | null,
    startPoint: isPoint(candidate.startPoint) ? candidate.startPoint : undefined,
    endPoint: isPoint(candidate.endPoint) ? candidate.endPoint : undefined,
  };
}

function isPoint(value: unknown): value is { x: number; y: number } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.x === "number" && typeof candidate.y === "number";
}

/**
 * Line/arrow endpoints: prefer `data.startPoint`/`endPoint` (the actual drag points, set by
 * `ShapeTool` — see `ShapeData`'s doc comment for why `bounds` alone can't carry direction).
 * Falls back to the bounds' top-left/bottom-right diagonal only for older data saved before
 * these fields existed, so a stale page still renders something rather than throwing.
 */
function lineEndpoints(object: ShapeObject): {
  start: { x: number; y: number };
  end: { x: number; y: number };
} {
  if (object.data.startPoint && object.data.endPoint) {
    return { start: object.data.startPoint, end: object.data.endPoint };
  }
  const { x, y, width, height } = object.bounds;
  return { start: { x, y }, end: { x: x + width, y: y + height } };
}

/** `origin` is the containing chunk's world-space offset — see PixiRenderer's doc comment. */
function drawShape(graphics: Graphics, object: ShapeObject, origin: ChunkOrigin): void {
  graphics.clear();
  const { kind, strokeColor, strokeWidth, fillColor } = object.data;
  const x = object.bounds.x - origin.x;
  const y = object.bounds.y - origin.y;
  const { width, height } = object.bounds;
  const stroke = { width: strokeWidth, color: strokeColor || DEFAULT_STROKE_COLOR };

  if (kind === "rectangle") {
    graphics.rect(x, y, width, height);
    if (fillColor) graphics.fill({ color: fillColor });
    graphics.stroke(stroke);
    return;
  }

  if (kind === "ellipse") {
    const cx = x + width / 2;
    const cy = y + height / 2;
    graphics.ellipse(cx, cy, Math.abs(width) / 2, Math.abs(height) / 2);
    if (fillColor) graphics.fill({ color: fillColor });
    graphics.stroke(stroke);
    return;
  }

  // line / arrow
  const endpoints = lineEndpoints(object);
  const start = { x: endpoints.start.x - origin.x, y: endpoints.start.y - origin.y };
  const end = { x: endpoints.end.x - origin.x, y: endpoints.end.y - origin.y };
  graphics
    .moveTo(start.x, start.y)
    .lineTo(end.x, end.y)
    .stroke({ ...stroke, cap: "round" });

  if (kind === "arrow") {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const leftX = end.x - ARROWHEAD_LENGTH * Math.cos(angle - ARROWHEAD_ANGLE);
    const leftY = end.y - ARROWHEAD_LENGTH * Math.sin(angle - ARROWHEAD_ANGLE);
    const rightX = end.x - ARROWHEAD_LENGTH * Math.cos(angle + ARROWHEAD_ANGLE);
    const rightY = end.y - ARROWHEAD_LENGTH * Math.sin(angle + ARROWHEAD_ANGLE);
    graphics
      .moveTo(end.x, end.y)
      .lineTo(leftX, leftY)
      .moveTo(end.x, end.y)
      .lineTo(rightX, rightY)
      .stroke({ ...stroke, cap: "round", join: "round" });
  }
}

export const shapeObjectType: ObjectTypeDefinition<"shape", ShapeData> = {
  type: "shape",

  validate: validateShapeData,

  createView(object, origin): Container {
    const graphics = new Graphics();
    drawShape(graphics, object, origin);
    return graphics;
  },

  updateView(view, object, origin): void {
    if (view instanceof Graphics) {
      drawShape(view, object, origin);
    }
  },

  hitTest(object, point): boolean {
    const { kind, strokeWidth } = object.data;
    if (kind === "rectangle" || kind === "ellipse") {
      const { x, y, width, height } = object.bounds;
      return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
    }
    // line / arrow: point-to-segment distance, same style as ink-stroke's hit-test.
    const { start, end } = lineEndpoints(object);
    const threshold = Math.max(2, strokeWidth);
    return distanceToSegment(point, start, end) <= threshold;
  },

  supportsRotation: true,
  supportsResize: true,
};
