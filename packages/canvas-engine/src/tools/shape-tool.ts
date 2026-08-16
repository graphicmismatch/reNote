import {
  identityTransform,
  newId,
  type Bounds,
  type PageObjectId,
  type ShapeData,
  type ShapeKind,
} from "@renote/core";
import type { CommandStack } from "../commands/command-stack.js";
import { AddObjectCommand } from "../commands/object-commands.js";
import type { ShapeObject } from "../objects/shape-object-type.js";
import type { SceneGraph } from "../scene/scene-graph.js";
import type { NormalizedPointerEvent } from "../input/pointer-event.js";
import type { InkSettingsRegistry } from "./ink-settings.js";
import type { Tool } from "./tool.js";

export interface ShapeToolOptions {
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string | null;
}

const DEFAULT_STROKE_COLOR = "#000000";
const DEFAULT_STROKE_WIDTH = 2;
/** Below this diagonal (page units), a drag is treated as a stray click, not a real shape. */
const MIN_COMMIT_DIAGONAL = 2;
/** Angle-snap increment for line/arrow endpoints, in radians (15 degrees). */
const ANGLE_SNAP_STEP = (15 * Math.PI) / 180;

/**
 * One `ShapeTool` instance per shape kind (constructor takes `kind` plus scene/commands), so
 * `registerBuiltInTools` registers four distinct tool ids — "shape-rectangle", "shape-ellipse",
 * "shape-line", "shape-arrow" — rather than one tool with mutable state the caller has to
 * remember to set before each gesture. This mirrors `PenTool`/highlighter's "configure via
 * constructor options, not a shared mutable mode field" approach.
 *
 * Live-preview: same bypass-the-command-stack pattern as `PenTool` (see its class doc comment)
 * — `onPointerMove` writes directly into the scene graph via `scene.add`/`scene.update` so the
 * user sees the shape grow with the drag, and the temporary object is removed the moment the
 * real, committed object replaces it on `onPointerUp`.
 *
 * Snapping (shiftKey-gated, always exact, not tolerance-based — so holding Shift is a
 * deterministic on/off switch rather than "sometimes snaps depending on drag angle," which
 * matters for testability as well as UX predictability):
 *  - line/arrow: the endpoint's angle from the start point snaps to the nearest 15-degree
 *    increment while preserving the drag's actual length.
 *  - rectangle/ellipse: the drag's larger of width/height becomes both width and height
 *    (forces a 1:1 aspect / square or circle), anchored at the start point.
 */
export class ShapeTool implements Tool {
  readonly id: string;
  readonly cursor = "crosshair";

  private activePointerId: number | null = null;
  private start: { x: number; y: number } | null = null;
  private livePreviewId: PageObjectId | null = null;

  constructor(
    private readonly scene: SceneGraph,
    private readonly commands: CommandStack<SceneGraph>,
    private readonly kind: ShapeKind,
    private readonly options: ShapeToolOptions = {},
    // Optional for the same reason as PenTool's — see its constructor's doc comment.
    private readonly inkSettings?: InkSettingsRegistry,
  ) {
    this.id = `shape-${kind}`;
  }

  onPointerDown(event: NormalizedPointerEvent): void {
    if (this.activePointerId !== null) return;
    this.activePointerId = event.pointerId;
    this.start = { x: event.x, y: event.y };
    this.livePreviewId = newId<PageObjectId>();
    this.renderLivePreview(event);
  }

  onPointerMove(event: NormalizedPointerEvent): void {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) return;
    this.renderLivePreview(event);
  }

  onPointerUp(event: NormalizedPointerEvent): void {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) return;
    this.commitShape(event);
  }

  onCancel(): void {
    this.clearLivePreview();
    this.reset();
  }

  private buildData(start: { x: number; y: number }, end: { x: number; y: number }): ShapeData {
    // See PenTool.buildData's doc comment: live settings win over construction-time options.
    const live = this.inkSettings?.get(this.id);
    return {
      kind: this.kind,
      strokeColor: live?.color ?? this.options.strokeColor ?? DEFAULT_STROKE_COLOR,
      strokeWidth: live?.width ?? this.options.strokeWidth ?? DEFAULT_STROKE_WIDTH,
      fillColor: this.options.fillColor ?? null,
      // Only meaningful for line/arrow (see ShapeData's doc comment); harmless to include
      // for rectangle/ellipse too, where renderers/hit-testing ignore it in favor of bounds.
      startPoint: start,
      endPoint: end,
    };
  }

  /** Applies this tool's snapping rule (see class doc comment) to the current drag endpoint. */
  private snappedEnd(
    start: { x: number; y: number },
    current: { x: number; y: number },
  ): { x: number; y: number } {
    const dx = current.x - start.x;
    const dy = current.y - start.y;

    if (this.kind === "line" || this.kind === "arrow") {
      const length = Math.hypot(dx, dy);
      if (length === 0) return current;
      const angle = Math.atan2(dy, dx);
      const snappedAngle = Math.round(angle / ANGLE_SNAP_STEP) * ANGLE_SNAP_STEP;
      return {
        x: start.x + length * Math.cos(snappedAngle),
        y: start.y + length * Math.sin(snappedAngle),
      };
    }

    // rectangle / ellipse: force 1:1 aspect using the larger drag delta, anchored at start.
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    const signX = dx < 0 ? -1 : 1;
    const signY = dy < 0 ? -1 : 1;
    return { x: start.x + side * signX, y: start.y + side * signY };
  }

  private boundsFor(start: { x: number; y: number }, end: { x: number; y: number }): Bounds {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
  }

  private renderLivePreview(event: NormalizedPointerEvent): void {
    if (!this.start || !this.livePreviewId) return;
    const end = event.shiftKey
      ? this.snappedEnd(this.start, { x: event.x, y: event.y })
      : { x: event.x, y: event.y };
    const object: ShapeObject = {
      id: this.livePreviewId,
      type: "shape",
      transform: identityTransform(),
      bounds: this.boundsFor(this.start, end),
      data: this.buildData(this.start, end),
    };
    if (this.scene.get(object.id)) {
      this.scene.update(object);
    } else {
      this.scene.add(object);
    }
  }

  private clearLivePreview(): void {
    if (this.livePreviewId && this.scene.get(this.livePreviewId)) {
      this.scene.remove(this.livePreviewId);
    }
  }

  private commitShape(event: NormalizedPointerEvent): void {
    this.clearLivePreview();
    if (this.start) {
      const end = event.shiftKey
        ? this.snappedEnd(this.start, { x: event.x, y: event.y })
        : { x: event.x, y: event.y };
      const bounds = this.boundsFor(this.start, end);
      if (Math.hypot(bounds.width, bounds.height) >= MIN_COMMIT_DIAGONAL) {
        const object: ShapeObject = {
          id: newId<PageObjectId>(),
          type: "shape",
          transform: identityTransform(),
          bounds,
          data: this.buildData(this.start, end),
        };
        this.commands.execute(new AddObjectCommand(object));
      }
    }
    this.reset();
  }

  private reset(): void {
    this.activePointerId = null;
    this.start = null;
    this.livePreviewId = null;
  }
}
