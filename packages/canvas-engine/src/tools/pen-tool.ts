import {
  identityTransform,
  newId,
  type InkStrokeData,
  type PageObject,
  type PageObjectId,
  type ShapeData,
} from "@renote/core";
import type { CommandStack } from "../commands/command-stack.js";
import { CompositeCommand } from "../commands/composite-command.js";
import { AddObjectCommand, RemoveObjectCommand } from "../commands/object-commands.js";
import { smoothStroke } from "../ink/catmull-rom.js";
import { isScratchOutGesture } from "../ink/gestures.js";
import { recognizeShape } from "../ink/ink-to-shape.js";
import type { StrokePoint } from "../ink/stroke-point.js";
import {
  boundsForStroke,
  type InkStrokeEngineData,
  type InkStrokeEngineObject,
} from "../objects/ink-stroke-object-type.js";
import type { ObjectTypeRegistry } from "../objects/registry.js";
import type { ShapeObject } from "../objects/shape-object-type.js";
import type { SceneGraph } from "../scene/scene-graph.js";
import type { NormalizedPointerEvent } from "../input/pointer-event.js";
import type { InkSettingsRegistry } from "./ink-settings.js";
import type { Tool } from "./tool.js";

export interface PenToolOptions {
  /** Tool id this instance registers under; defaults to "pen". Lets a second `PenTool`
   *  instance register as e.g. "highlighter" without any subclassing. */
  toolId?: string;
  tool?: InkStrokeData["tool"];
  color?: string;
  width?: number;
  /**
   * When true, `commitStroke` runs `recognizeShape` on the smoothed points and, on a
   * confident match, commits a `shape` object instead of an `ink-stroke` — still through
   * a single `AddObjectCommand`. Defaults to false: a plain pen keeps producing ink strokes
   * unless a caller opts in explicitly (see ink/ink-to-shape.ts).
   */
  recognizeShapes?: boolean;
  /**
   * Live override for `recognizeShapes`, checked first on every commit — a plain `{ current }`
   * box (not a React `MutableRefObject`; this package has no React dependency) so a Settings
   * toggle can flip behavior for the very next stroke without recreating this tool instance,
   * the same idiom `SettingsProvider`'s `pointerSourceOverridesRef` uses in apps/desktop.
   */
  recognizeShapesRef?: { current: boolean };
}

const DEFAULT_COLOR = "#000000";
const DEFAULT_WIDTH = 2;
/**
 * Fewer interpolated samples per segment than the final commit's `smoothStroke` default (8):
 * the live preview re-smooths the *entire* stroke-so-far on every pointermove (see
 * `renderLivePreview`), so its cost scales with the stroke's current length — a lower sample
 * count keeps that cheap during a long gesture while still looking smooth in motion. The final
 * commit re-runs `smoothStroke` once at full quality, so this only affects the in-progress look.
 */
const LIVE_PREVIEW_SAMPLES_PER_SEGMENT = 4;

/**
 * Freehand ink capture. Accumulates raw pointer samples for the duration of one stroke gesture,
 * then on pointer-up smooths them via `smoothStroke` and commits a single `ink-stroke`
 * `PageObject` through an `AddObjectCommand` so the stroke participates in undo/redo.
 *
 * Live-preview exception: while the stroke is in progress, `onPointerMove` writes a
 * temporary `ink-stroke` object directly into the scene graph via `scene.add`/`scene.update`,
 * bypassing the command stack entirely. This is the one deliberate exception to "every mutation
 * goes through a command" called out in the architecture plan: the in-progress stroke is not a
 * committed edit yet (the user could still be mid-gesture), so it must not appear in undo
 * history, and re-running `smoothStroke` + full command dispatch on every pointermove would add
 * needless smoothing/bookkeeping cost to a hot path. The temporary object is deleted (again by
 * direct `scene.remove`, not a command) the moment the real, smoothed, undoable object is
 * committed on pointer-up, so it never coexists with the final object and never leaks into
 * history.
 */
export class PenTool implements Tool {
  readonly id: string;
  readonly cursor = "crosshair";

  private raw: StrokePoint[] = [];
  private activePointerId: number | null = null;
  private livePreviewId: PageObjectId | null = null;

  constructor(
    private readonly scene: SceneGraph,
    private readonly commands: CommandStack<SceneGraph>,
    private readonly options: PenToolOptions = {},
    // Optional so existing direct-construction call sites (this file's own tests) keep
    // compiling/behaving unchanged — with no registry, buildData() falls back to `options`
    // exactly as before this field existed. `registerBuiltInTools` always passes one.
    private readonly inkSettings?: InkSettingsRegistry,
    // Optional, same reasoning as `inkSettings` — without it the scratch-out gesture (which
    // needs real per-type hit-testing, not just bounding boxes) is simply disabled.
    // `registerBuiltInTools` always passes one.
    private readonly objectTypes?: ObjectTypeRegistry,
  ) {
    this.id = options.toolId ?? "pen";
  }

  onPointerDown(event: NormalizedPointerEvent): void {
    if (event.isEraser || this.activePointerId !== null) return;
    this.activePointerId = event.pointerId;
    this.raw = [{ x: event.x, y: event.y, pressure: event.pressure }];
    this.livePreviewId = newId<PageObjectId>();
    this.renderLivePreview();
  }

  onPointerMove(event: NormalizedPointerEvent): void {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) return;
    this.raw.push({ x: event.x, y: event.y, pressure: event.pressure });
    this.renderLivePreview();
  }

  onPointerUp(event: NormalizedPointerEvent): void {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) return;
    this.commitStroke();
  }

  onCancel(): void {
    this.clearLivePreview();
    this.reset();
  }

  private buildData(points: readonly StrokePoint[]): InkStrokeEngineData {
    // Live settings (set via a color/width picker) win over construction-time `options` —
    // read fresh on every commit/preview so a mid-session color change applies to the very
    // next stroke without recreating this tool instance. Falls back through `options` then
    // the hardcoded default when no registry is wired up (e.g. this file's own unit tests).
    const live = this.inkSettings?.get(this.id);
    return {
      tool: this.options.tool ?? "pen",
      color: live?.color ?? this.options.color ?? DEFAULT_COLOR,
      width: live?.width ?? this.options.width ?? DEFAULT_WIDTH,
      // No storage wiring yet in this phase; the real asset path is assigned when
      // renote-storage persists the stroke's point data to disk.
      pointDataAssetPath: "",
      points: [...points],
    };
  }

  /**
   * See class doc comment: bypasses the command stack on purpose, this is not a committed edit.
   * Also smooths the stroke-so-far (at a cheaper sample rate than the final commit — see
   * `LIVE_PREVIEW_SAMPLES_PER_SEGMENT`) rather than rendering `this.raw` verbatim, so the
   * in-progress stroke already looks like the final curve instead of a jagged raw-sample
   * polyline that suddenly "pops" smooth on pointer-up.
   */
  private renderLivePreview(): void {
    if (!this.livePreviewId || this.raw.length === 0) return;
    const previewPoints =
      this.raw.length >= 3 ? smoothStroke(this.raw, LIVE_PREVIEW_SAMPLES_PER_SEGMENT) : this.raw;
    const data = this.buildData(previewPoints);
    const object: InkStrokeEngineObject = {
      id: this.livePreviewId,
      type: "ink-stroke",
      transform: identityTransform(),
      bounds: boundsForStroke(previewPoints, data.width),
      data,
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

  /**
   * Scratch-out-to-erase: if the just-drawn stroke reads as a scratch-out gesture (see
   * `isScratchOutGesture`) AND it overlaps at least one real object, that's the whole gesture —
   * delete what it crossed instead of committing the scribble itself. Every touched object is
   * removed in one `CompositeCommand`, so it's one undo step regardless of how much it crossed.
   * Returns null (a no-op) when there's no `objectTypes` registry, the shape doesn't match, or
   * it doesn't overlap anything — in which case the stroke commits as ordinary ink.
   *
   * Runs on `this.raw`, not the Catmull-Rom-smoothed points: smoothing exists to make a
   * deliberate stroke look nice and, in the process, rounds off exactly the sharp direction
   * reversals that make a scratch-out recognizable. Raw pointer samples are jagged by
   * construction — the same reason the eraser tools hit-test raw per-move samples too.
   */
  private tryEraseGesture(points: readonly StrokePoint[]): CompositeCommand<SceneGraph> | null {
    if (!this.objectTypes || !isScratchOutGesture(points)) return null;
    const touched = new Map<PageObjectId, PageObject>();
    for (const point of points) {
      for (const id of this.scene.hitTestPoint(point.x, point.y, this.objectTypes)) {
        if (touched.has(id)) continue;
        const object = this.scene.get(id);
        if (object) touched.set(id, object);
      }
    }
    if (touched.size === 0) return null;
    return new CompositeCommand(Array.from(touched.values(), (object) => new RemoveObjectCommand(object)));
  }

  private commitStroke(): void {
    this.clearLivePreview();
    if (this.raw.length > 0) {
      const eraseCommand = this.tryEraseGesture(this.raw);
      if (eraseCommand) {
        this.commands.execute(eraseCommand);
        this.reset();
        return;
      }

      const smoothed = smoothStroke(this.raw);

      if (this.options.recognizeShapesRef?.current ?? this.options.recognizeShapes) {
        const recognized = recognizeShape(smoothed);
        if (recognized) {
          const live = this.inkSettings?.get(this.id);
          const shape: ShapeObject = {
            id: newId<PageObjectId>(),
            type: "shape",
            transform: identityTransform(),
            bounds: recognized.bounds,
            data: {
              kind: recognized.kind,
              strokeColor: live?.color ?? this.options.color ?? DEFAULT_COLOR,
              strokeWidth: live?.width ?? this.options.width ?? DEFAULT_WIDTH,
              fillColor: null,
              startPoint: recognized.startPoint,
              endPoint: recognized.endPoint,
            } satisfies ShapeData,
          };
          this.commands.execute(new AddObjectCommand(shape));
          this.reset();
          return;
        }
      }

      const data = this.buildData(smoothed);
      const object: InkStrokeEngineObject = {
        id: newId<PageObjectId>(),
        type: "ink-stroke",
        transform: identityTransform(),
        bounds: boundsForStroke(smoothed, data.width),
        data,
      };
      this.commands.execute(new AddObjectCommand(object));
    }
    this.reset();
  }

  private reset(): void {
    this.raw = [];
    this.activePointerId = null;
    this.livePreviewId = null;
  }
}
