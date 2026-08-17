import {
  applyTransformToPoint,
  boundsCenter,
  newId,
  type Bounds,
  type EditableCommand,
  type PageObjectId,
  type Point2D,
} from "@renote/core";
import type { CommandStack } from "../commands/command-stack.js";
import { CompositeCommand } from "../commands/composite-command.js";
import { AddObjectCommand, RemoveObjectCommand, UpdateObjectCommand } from "../commands/object-commands.js";
import type { StrokePoint } from "../ink/stroke-point.js";
import { boundsForStroke, type InkStrokeEngineObject } from "../objects/ink-stroke-object-type.js";
import type { SceneGraph } from "../scene/scene-graph.js";
import type { NormalizedPointerEvent } from "../input/pointer-event.js";
import type { InkSettingsRegistry } from "./ink-settings.js";
import type { Tool } from "./tool.js";

export interface PixelEraserToolOptions {
  /** Radius (page units) around each sampled eraser-path point within which stroke points are removed. */
  radius?: number;
}

const DEFAULT_RADIUS = 10;

/**
 * Erases only the portion of an ink-stroke's points near the eraser's path, rather than the
 * whole stroke (contrast `StrokeEraserTool`). Scope decision, documented here rather than left
 * implicit: a point is erased if it falls within `radius` of ANY sampled pointer position
 * recorded during this drag (no interpolation between samples — a very fast drag can therefore
 * skip over a thin stroke between two samples; this is a known, accepted limitation rather than
 * a bug, callable out for a future "resample the path at a fixed step" improvement).
 *
 * Split-vs-no-split decision: **split**. When erasing leaves one or more contiguous runs of
 * surviving points, each run becomes its own new `ink-stroke` object (via `AddObjectCommand`)
 * and the original is removed (`RemoveObjectCommand`), rather than collapsing all survivors into
 * one array (which would visually reconnect the two sides of a middle erase with a straight
 * line). Splitting is a few extra lines and gives visually-correct results, and it's also the
 * scenario `CompositeCommand` exists to support (mixed Remove+Add+Update sub-commands in one
 * undo step).
 *
 * Live preview: every path update recomputes the erase (same `eraseFromStroke` used for the real
 * commit) and applies the resulting commands' `do()` directly to the scene, bypassing the command
 * stack. Each recompute first reverts the previous frame's preview via those same commands'
 * `undo()`, so it always runs against true pre-gesture scene state — exactly the corruption
 * `UpdateObjectCommand`'s "capture previous state from the live scene" constructor doc comment
 * warns about avoiding. `onPointerUp` reverts the preview once more before building and executing
 * the real commands through the command stack, so nothing lands in undo history until commit.
 */
export class PixelEraserTool implements Tool {
  readonly id = "pixel-eraser";
  readonly cursor = "cell";

  private activePointerId: number | null = null;
  private path: StrokePoint[] = [];
  private liveCommands: EditableCommand<SceneGraph>[] = [];
  private readonly fallbackRadius: number;

  constructor(
    private readonly scene: SceneGraph,
    private readonly commands: CommandStack<SceneGraph>,
    options: PixelEraserToolOptions = {},
    // Optional for the same reason as PenTool's — see its constructor's doc comment. The
    // registry's generic `width` field doubles as this tool's radius (see ink-settings.ts).
    private readonly inkSettings?: InkSettingsRegistry,
  ) {
    this.fallbackRadius = options.radius ?? DEFAULT_RADIUS;
  }

  /** Live radius (page units) — reads the current settings-registry value if one is wired
   *  up, so a mid-session size change applies to the next gesture without recreating this
   *  tool. Read once per gesture at commit time, not per sampled point, for simplicity. */
  private currentRadius(): number {
    return this.inkSettings?.get(this.id)?.width ?? this.fallbackRadius;
  }

  onPointerDown(event: NormalizedPointerEvent): void {
    if (this.activePointerId !== null) return;
    this.activePointerId = event.pointerId;
    this.path = [{ x: event.x, y: event.y, pressure: event.pressure }];
    this.renderLivePreview();
  }

  onPointerMove(event: NormalizedPointerEvent): void {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) return;
    this.path.push({ x: event.x, y: event.y, pressure: event.pressure });
    this.renderLivePreview();
  }

  onPointerUp(event: NormalizedPointerEvent): void {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) return;
    this.path.push({ x: event.x, y: event.y, pressure: event.pressure });
    this.restoreLivePreview();
    this.commitErase();
  }

  onCancel(): void {
    this.restoreLivePreview();
    this.reset();
  }

  /** Recomputes and applies this gesture's erase directly to the scene, for visual feedback
   *  before the stroke is finished. Always starts by reverting the previous frame's preview
   *  (see class doc comment) so the recompute runs against true pre-gesture state. */
  private renderLivePreview(): void {
    this.restoreLivePreview();
    if (this.path.length === 0) return;

    const radius = this.currentRadius();
    const candidateIds = this.scene.spatialIndex.queryRect(this.pathBounds(radius)) as PageObjectId[];
    const commands: EditableCommand<SceneGraph>[] = [];
    for (const id of candidateIds) {
      const object = this.scene.get(id);
      if (!object || object.type !== "ink-stroke") continue;
      commands.push(...this.eraseFromStroke(object as InkStrokeEngineObject, radius));
    }
    for (const command of commands) command.do(this.scene);
    this.liveCommands = commands;
  }

  private restoreLivePreview(): void {
    for (let i = this.liveCommands.length - 1; i >= 0; i -= 1) {
      this.liveCommands[i]!.undo(this.scene);
    }
    this.liveCommands = [];
  }

  private commitErase(): void {
    if (this.path.length === 0) {
      this.reset();
      return;
    }

    const radius = this.currentRadius();
    const pathBounds = this.pathBounds(radius);
    const candidateIds = this.scene.spatialIndex.queryRect(pathBounds) as PageObjectId[];
    const subCommands: EditableCommand<SceneGraph>[] = [];

    for (const id of candidateIds) {
      const object = this.scene.get(id);
      if (!object || object.type !== "ink-stroke") continue;
      const stroke = object as InkStrokeEngineObject;
      const commandsForStroke = this.eraseFromStroke(stroke, radius);
      subCommands.push(...commandsForStroke);
    }

    if (subCommands.length > 0) {
      this.commands.execute(new CompositeCommand(subCommands));
    }
    this.reset();
  }

  /** Returns the sub-commands needed to apply this gesture's erase to a single stroke, or []
   *  if the eraser path never came within `radius` of any of its points.
   *
   * `stroke.data.points` are in the stroke's own local (pre-transform) space, while
   * `this.path` is the eraser's real world-space pointer trail — see `transform.ts`'s doc
   * comment — so each stroke point is forward-transformed to world space before the distance
   * check. A no-op under the identity transform every freshly-drawn stroke starts with. */
  private eraseFromStroke(stroke: InkStrokeEngineObject, radius: number): EditableCommand<SceneGraph>[] {
    const points = stroke.data.points;
    const pivot = boundsCenter(stroke.bounds);
    const survivingRuns: StrokePoint[][] = [];
    let currentRun: StrokePoint[] = [];
    let erasedAny = false;

    for (const point of points) {
      const worldPoint = applyTransformToPoint(point, stroke.transform, pivot);
      if (this.isNearPath(worldPoint, radius)) {
        erasedAny = true;
        if (currentRun.length > 0) {
          survivingRuns.push(currentRun);
          currentRun = [];
        }
      } else {
        currentRun.push(point);
      }
    }
    if (currentRun.length > 0) survivingRuns.push(currentRun);

    if (!erasedAny) return [];

    if (survivingRuns.length === 0) {
      return [new RemoveObjectCommand(stroke)];
    }

    if (survivingRuns.length === 1) {
      const trimmedPoints = survivingRuns[0]!;
      const next: InkStrokeEngineObject = {
        ...stroke,
        bounds: boundsForStroke(trimmedPoints, stroke.data.width),
        data: { ...stroke.data, points: trimmedPoints },
      };
      return [new UpdateObjectCommand(this.scene, stroke.id, next)];
    }

    // 2+ surviving runs: remove the original, add one new stroke per contiguous run.
    const splitCommands: EditableCommand<SceneGraph>[] = [new RemoveObjectCommand(stroke)];
    for (const run of survivingRuns) {
      const split: InkStrokeEngineObject = {
        id: newId<PageObjectId>(),
        type: "ink-stroke",
        // Preserves the original stroke's transform (e.g. a prior move's translation) rather
        // than resetting to identity — `run`'s points and `boundsForStroke`'s result are still
        // in the same local space the original stroke was in, so the split piece must keep
        // the same transform to render/hit-test in the same place the original occupied.
        transform: stroke.transform,
        bounds: boundsForStroke(run, stroke.data.width),
        data: { ...stroke.data, points: run },
      };
      splitCommands.push(new AddObjectCommand(split));
    }
    return splitCommands;
  }

  private isNearPath(point: Point2D, radius: number): boolean {
    for (const sample of this.path) {
      if (Math.hypot(point.x - sample.x, point.y - sample.y) <= radius) return true;
    }
    return false;
  }

  private pathBounds(radius: number): Bounds {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of this.path) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return {
      x: minX - radius,
      y: minY - radius,
      width: maxX - minX + radius * 2,
      height: maxY - minY + radius * 2,
    };
  }

  private reset(): void {
    this.activePointerId = null;
    this.path = [];
  }
}
