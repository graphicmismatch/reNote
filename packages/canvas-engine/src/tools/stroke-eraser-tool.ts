import type { PageObject, PageObjectId } from "@renote/core";
import type { CommandStack } from "../commands/command-stack.js";
import { CompositeCommand } from "../commands/composite-command.js";
import { RemoveObjectCommand } from "../commands/object-commands.js";
import type { ObjectTypeRegistry } from "../objects/registry.js";
import type { SceneGraph } from "../scene/scene-graph.js";
import type { NormalizedPointerEvent } from "../input/pointer-event.js";
import type { InkSettingsRegistry } from "./ink-settings.js";
import type { Tool } from "./tool.js";

export interface StrokeEraserToolOptions {
  /** Tolerance radius (page units) around the cursor within which an object still counts as
   *  "touched" — see class doc comment for why this exists alongside exact-point hit-testing. */
  radius?: number;
}

const DEFAULT_RADIUS = 8;
/** Ring samples around the cursor at `radius`, in addition to the exact cursor point itself —
 *  see `eraseAt`'s doc comment. */
const RADIUS_SAMPLE_COUNT = 8;

/**
 * Erases whole objects the eraser passes over. Hit-tests every pointer-down/move sample against
 * the scene via `SceneGraph.hitTestPoint(x, y, objectTypes)` (the 3-arg overload — real
 * per-type `hitTest`, e.g. an ink stroke's actual path, not just its bounding box), and queues
 * every newly-touched object for removal. Nothing is mutated until `onPointerUp`: all objects
 * touched during one continuous drag are removed via a single `CompositeCommand` wrapping one
 * `RemoveObjectCommand` per object, executed once — so erasing three strokes in one drag is one
 * undo step, not three. An object already queued in this gesture is never re-queued.
 *
 * `radius` (live-settable, like `PixelEraserTool`'s — see `ink-settings.ts`) exists because a
 * literal single-point hit test makes thin strokes hard to actually touch; it's a tolerance, not
 * a brush shape, so hit-testing samples a small ring of points around the cursor at `radius` in
 * addition to the exact point, unioning whatever any sample touches — cheaper than resampling
 * the whole drag path at a fixed step, and precise enough for a tolerance rather than an erase
 * area with its own geometry.
 */
export class StrokeEraserTool implements Tool {
  readonly id = "stroke-eraser";
  readonly cursor = "cell";

  private activePointerId: number | null = null;
  private touched = new Map<PageObjectId, PageObject>();
  private readonly fallbackRadius: number;

  constructor(
    private readonly scene: SceneGraph,
    private readonly commands: CommandStack<SceneGraph>,
    private readonly objectTypes: ObjectTypeRegistry,
    options: StrokeEraserToolOptions = {},
    // Optional for the same reason as PenTool's — see its constructor's doc comment.
    private readonly inkSettings?: InkSettingsRegistry,
  ) {
    this.fallbackRadius = options.radius ?? DEFAULT_RADIUS;
  }

  private currentRadius(): number {
    return this.inkSettings?.get(this.id)?.width ?? this.fallbackRadius;
  }

  onPointerDown(event: NormalizedPointerEvent): void {
    if (this.activePointerId !== null) return;
    this.activePointerId = event.pointerId;
    this.touched = new Map();
    this.eraseAt(event.x, event.y);
  }

  onPointerMove(event: NormalizedPointerEvent): void {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) return;
    this.eraseAt(event.x, event.y);
  }

  onPointerUp(event: NormalizedPointerEvent): void {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) return;
    this.commitErase();
  }

  onCancel(): void {
    this.reset();
  }

  private eraseAt(x: number, y: number): void {
    const radius = this.currentRadius();
    const hitIds = new Set<PageObjectId>(this.scene.hitTestPoint(x, y, this.objectTypes));
    if (radius > 0) {
      for (let i = 0; i < RADIUS_SAMPLE_COUNT; i += 1) {
        const angle = (i / RADIUS_SAMPLE_COUNT) * Math.PI * 2;
        const sampleX = x + radius * Math.cos(angle);
        const sampleY = y + radius * Math.sin(angle);
        for (const id of this.scene.hitTestPoint(sampleX, sampleY, this.objectTypes)) {
          hitIds.add(id);
        }
      }
    }
    for (const id of hitIds) {
      if (this.touched.has(id)) continue;
      const object = this.scene.get(id);
      if (object) this.touched.set(id, object);
    }
  }

  private commitErase(): void {
    if (this.touched.size > 0) {
      const subCommands = Array.from(this.touched.values()).map((object) => new RemoveObjectCommand(object));
      this.commands.execute(new CompositeCommand(subCommands));
    }
    this.reset();
  }

  private reset(): void {
    this.activePointerId = null;
    this.touched = new Map();
  }
}
