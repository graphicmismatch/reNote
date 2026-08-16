import {
  boundsCenter,
  EventBus,
  transformedBounds,
  type PageObject,
  type PageObjectId,
  type Transform2D,
} from "@renote/core";
import type { CommandStack } from "../commands/command-stack.js";
import { CompositeCommand } from "../commands/composite-command.js";
import { UpdateObjectCommand } from "../commands/object-commands.js";
import { ObjectTypeRegistry } from "../objects/registry.js";
import {
  computeSelectionGeometry,
  hitTestHandle,
  type HandleId,
  type ResizeHandleId,
  type SelectionGeometry,
} from "../selection/selection-geometry.js";
import type { SceneGraph } from "../scene/scene-graph.js";
import type { SelectionManager } from "../selection/selection-manager.js";
import type { PageEngineEventBus, PageEngineEvents } from "../text-edit-events.js";
import type { NormalizedPointerEvent } from "../input/pointer-event.js";
import type { Tool } from "./tool.js";

/** Two pointer-downs on the same object within this window count as a double-click. */
const DOUBLE_CLICK_WINDOW_MS = 400;
/** Below this world-space drag distance, a gesture is treated as a stray click, not a real
 *  move/rotate/scale — so clicking an already-selected object without moving it never adds a
 *  no-op entry to the undo history. */
const MIN_GESTURE_DISTANCE = 0.5;
/** Angle-snap increment for shift-held rotation, in radians (15 degrees) — same convention as
 *  `ShapeTool`'s line/arrow angle snap. */
const ROTATE_SNAP_STEP = (15 * Math.PI) / 180;
/** A dragged corner/edge handle can never shrink an object's scale below this, so a fast or
 *  inverted drag can't collapse it to zero/negative size (which would corrupt rendering and
 *  hit-testing). */
const MIN_SCALE = 0.05;

type GestureMode = "idle" | "moving" | "rotating" | "scaling";

const RESIZE_AXES: Record<ResizeHandleId, { x: boolean; y: boolean }> = {
  n: { x: false, y: true },
  s: { x: false, y: true },
  e: { x: true, y: false },
  w: { x: true, y: false },
  ne: { x: true, y: true },
  nw: { x: true, y: true },
  se: { x: true, y: true },
  sw: { x: true, y: true },
};

function rotateVector(v: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

function clampScale(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.max(MIN_SCALE, Math.abs(value));
}

/**
 * Click-to-select / click-empty-space-to-clear, shift-click to add/remove from a multi-object
 * selection, drag-to-move, and — via `selection-geometry.ts`'s handles — drag-to-rotate and
 * drag-to-resize. Every gesture (move/rotate/scale) follows the same live-preview pattern as
 * `PenTool`/`ShapeTool`: `onPointerMove` mutates the scene graph directly via `scene.update()`
 * for immediate visual feedback, and the real undoable command is only built and executed once,
 * in `onPointerUp`, from a snapshot of every affected object taken BEFORE the first live
 * mutation (see `UpdateObjectCommand`'s `explicitPrevious` param) — so undo always restores the
 * true pre-gesture state, not just the last live-preview frame.
 *
 * Rotate/scale are capability-gated per `ObjectTypeDefinition.supportsRotation`/`supportsResize`
 * (an ink-stroke, for instance, only supports move) — `selection-geometry.ts`'s
 * `computeSelectionGeometry` only produces those handles when every selected object's type
 * allows it, so an ungrantable gesture simply has no handle to grab.
 *
 * Also owns the text-box DOM-overlay trigger: double-clicking a `text-box` object emits
 * `"text-edit:begin"` on `textEditEvents` (see text-edit-events.ts for the full contract);
 * clicking anything else while a text box is being edited, or `onCancel` (Escape), emits
 * `"text-edit:end"`.
 */
export class SelectTool implements Tool {
  readonly id = "select";
  readonly cursor = "default";

  private lastClickObjectId: PageObjectId | null = null;
  private lastClickTime = 0;
  private editingObjectId: PageObjectId | null = null;

  private activePointerId: number | null = null;
  private mode: GestureMode = "idle";
  private dragStart: { x: number; y: number } | null = null;
  /** Snapshot of every affected object's state as of the moment the gesture began, keyed by id —
   *  the source of truth `onPointerUp`'s commands restore to on undo, and `onCancel` reverts the
   *  live-mutated scene back to if the gesture is aborted mid-drag. */
  private dragSnapshots = new Map<PageObjectId, PageObject>();
  private gestureGeometry: SelectionGeometry | null = null;
  private grabbedHandle: HandleId | null = null;
  private gestureChanged = false;

  constructor(
    private readonly sceneGraph: SceneGraph,
    private readonly selection: SelectionManager,
    private readonly commands: CommandStack<SceneGraph>,
    // Defaults to an empty registry (every type falls back to broad-phase hit-testing and
    // "supports everything") rather than being optional/undefined — see the class doc comment;
    // real callers (`registerBuiltInTools`) always pass `engine.objectTypes`.
    private readonly objectTypes: ObjectTypeRegistry = new ObjectTypeRegistry(),
    /** Live camera zoom, read fresh at the start of every gesture and on every handle hit-test —
     *  converts the handles' constant on-screen size/tolerance into world units. Defaults to a
     *  fixed 1x for tests/callers that don't care about zoom-dependent handle sizing. */
    private readonly getZoom: () => number = () => 1,
    // Optional for the same back-compat reason as before this class supported multi-select/
    // transform gestures — existing 2-arg-equivalent call sites keep compiling.
    private readonly textEditEvents: PageEngineEventBus = new EventBus<PageEngineEvents>(),
  ) {
    // `editingObjectId` must stay correct even when something OTHER than this tool's own
    // `endEditing()` ends the edit — e.g. `apps/desktop`'s `PageEditorView` emitting
    // "text-edit:end" directly in response to a UI interaction outside the canvas entirely
    // (switching tools, opening Settings, ...), which never goes through this class at all.
    // Without this, `editingObjectId` would stay stale after such an outside end, and a
    // follow-up double-click on that same object would then silently no-op forever (see
    // `maybeHandleDoubleClick`'s own `this.editingObjectId === objectId` guard) instead of
    // reopening it for editing.
    this.textEditEvents.on("text-edit:end", ({ objectId }) => {
      if (this.editingObjectId === objectId) this.editingObjectId = null;
    });
  }

  onPointerDown(event: NormalizedPointerEvent): void {
    if (this.activePointerId !== null) return;

    const selectedObjects = this.currentSelectionObjects();
    if (selectedObjects.length > 0) {
      const geometry = computeSelectionGeometry(selectedObjects, this.objectTypes, this.getZoom());
      const handle = geometry && hitTestHandle(geometry, { x: event.x, y: event.y }, this.getZoom());
      if (geometry && handle) {
        this.beginHandleGesture(event, geometry, handle.id, selectedObjects);
        return;
      }
    }

    const hits = this.sceneGraph.hitTestPoint(event.x, event.y, this.objectTypes);
    const topHit = hits[hits.length - 1] as PageObjectId | undefined;

    if (this.editingObjectId && this.editingObjectId !== topHit) {
      this.endEditing();
    }

    if (topHit) {
      if (event.shiftKey) {
        this.selection.toggle(topHit);
      } else if (!this.selection.isSelected(topHit)) {
        this.selection.set([topHit]);
      }
      this.maybeHandleDoubleClick(topHit);
      if (this.selection.isSelected(topHit)) {
        this.beginMoveGesture(event);
      }
    } else if (!event.shiftKey) {
      this.selection.clear();
      this.lastClickObjectId = null;
    }
  }

  onPointerMove(event: NormalizedPointerEvent): void {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) return;
    if (!this.dragStart) return;

    const distance = Math.hypot(event.x - this.dragStart.x, event.y - this.dragStart.y);
    if (distance >= MIN_GESTURE_DISTANCE) this.gestureChanged = true;
    if (!this.gestureChanged) return;

    if (this.mode === "moving") {
      this.applyMove(event);
    } else if (this.mode === "rotating" && this.gestureGeometry) {
      this.applyRotate(event, this.gestureGeometry);
    } else if (this.mode === "scaling" && this.gestureGeometry && this.grabbedHandle) {
      this.applyScale(event, this.gestureGeometry, this.grabbedHandle as ResizeHandleId);
    }
  }

  onPointerUp(event: NormalizedPointerEvent): void {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) return;
    this.commitGesture();
  }

  onCancel(): void {
    this.revertGesture();
    this.endEditing();
    this.selection.clear();
    this.reset();
  }

  // --- Gesture start -------------------------------------------------------

  private beginMoveGesture(event: NormalizedPointerEvent): void {
    this.activePointerId = event.pointerId;
    this.mode = "moving";
    this.dragStart = { x: event.x, y: event.y };
    this.gestureChanged = false;
    this.gestureGeometry = null;
    this.grabbedHandle = null;
    this.snapshotSelection();
  }

  private beginHandleGesture(
    event: NormalizedPointerEvent,
    geometry: SelectionGeometry,
    handleId: HandleId,
    selectedObjects: readonly PageObject[],
  ): void {
    if (this.editingObjectId) this.endEditing();
    this.activePointerId = event.pointerId;
    this.mode = handleId === "rotate" ? "rotating" : "scaling";
    this.dragStart = { x: event.x, y: event.y };
    this.gestureChanged = false;
    this.gestureGeometry = geometry;
    this.grabbedHandle = handleId;
    this.dragSnapshots = new Map(selectedObjects.map((object) => [object.id, structuredClone(object)]));
  }

  private snapshotSelection(): void {
    this.dragSnapshots = new Map(
      this.currentSelectionObjects().map((object) => [object.id, structuredClone(object)]),
    );
  }

  private currentSelectionObjects(): PageObject[] {
    const objects: PageObject[] = [];
    for (const id of this.selection.selectedIds) {
      const object = this.sceneGraph.get(id);
      if (object) objects.push(object);
    }
    return objects;
  }

  // --- Live preview ----------------------------------------------------------

  private applyMove(event: NormalizedPointerEvent): void {
    if (!this.dragStart) return;
    const dx = event.x - this.dragStart.x;
    const dy = event.y - this.dragStart.y;
    for (const original of this.dragSnapshots.values()) {
      const next: PageObject = {
        ...original,
        transform: { ...original.transform, x: original.transform.x + dx, y: original.transform.y + dy },
      };
      this.sceneGraph.update(next);
    }
  }

  private applyRotate(event: NormalizedPointerEvent, geometry: SelectionGeometry): void {
    if (!this.dragStart) return;
    const pivot = geometry.pivot;
    const startAngle = Math.atan2(this.dragStart.y - pivot.y, this.dragStart.x - pivot.x);
    const currentAngle = Math.atan2(event.y - pivot.y, event.x - pivot.x);
    let deltaAngle = currentAngle - startAngle;
    if (event.shiftKey) {
      deltaAngle = Math.round(deltaAngle / ROTATE_SNAP_STEP) * ROTATE_SNAP_STEP;
    }

    for (const original of this.dragSnapshots.values()) {
      const localCenter = boundsCenter(original.bounds);
      const originalCenterWorld = {
        x: localCenter.x + original.transform.x,
        y: localCenter.y + original.transform.y,
      };
      const offsetFromPivot = { x: originalCenterWorld.x - pivot.x, y: originalCenterWorld.y - pivot.y };
      const rotatedOffset = rotateVector(offsetFromPivot, deltaAngle);
      const newCenterWorld = { x: pivot.x + rotatedOffset.x, y: pivot.y + rotatedOffset.y };
      const transform: Transform2D = {
        ...original.transform,
        rotation: original.transform.rotation + deltaAngle,
        x: original.transform.x + (newCenterWorld.x - originalCenterWorld.x),
        y: original.transform.y + (newCenterWorld.y - originalCenterWorld.y),
      };
      this.sceneGraph.update({ ...original, transform });
    }
  }

  private applyScale(
    event: NormalizedPointerEvent,
    geometry: SelectionGeometry,
    handleId: ResizeHandleId,
  ): void {
    if (!this.dragStart) return;
    const pivot = geometry.pivot;
    const axes = RESIZE_AXES[handleId];
    const startVector = rotateVector(
      { x: this.dragStart.x - pivot.x, y: this.dragStart.y - pivot.y },
      -geometry.rotation,
    );
    const currentVector = rotateVector({ x: event.x - pivot.x, y: event.y - pivot.y }, -geometry.rotation);

    let factorX = 1;
    let factorY = 1;
    if (axes.x && axes.y) {
      // Corner handle: uniform scale from the radial distance to the pivot.
      const startDistance = Math.hypot(startVector.x, startVector.y);
      const currentDistance = Math.hypot(currentVector.x, currentVector.y);
      const factor = startDistance > 1e-6 ? currentDistance / startDistance : 1;
      factorX = factor;
      factorY = factor;
    } else if (axes.x) {
      factorX = Math.abs(startVector.x) > 1e-6 ? currentVector.x / startVector.x : 1;
    } else {
      factorY = Math.abs(startVector.y) > 1e-6 ? currentVector.y / startVector.y : 1;
    }
    factorX = clampScale(factorX);
    factorY = clampScale(factorY);

    for (const original of this.dragSnapshots.values()) {
      const localCenter = boundsCenter(original.bounds);
      const originalCenterWorld = {
        x: localCenter.x + original.transform.x,
        y: localCenter.y + original.transform.y,
      };
      const offsetFromPivot = { x: originalCenterWorld.x - pivot.x, y: originalCenterWorld.y - pivot.y };
      const scaledOffset = { x: offsetFromPivot.x * factorX, y: offsetFromPivot.y * factorY };
      const newCenterWorld = { x: pivot.x + scaledOffset.x, y: pivot.y + scaledOffset.y };
      const transform: Transform2D = {
        ...original.transform,
        scaleX: clampScale(original.transform.scaleX * factorX),
        scaleY: clampScale(original.transform.scaleY * factorY),
        x: original.transform.x + (newCenterWorld.x - originalCenterWorld.x),
        y: original.transform.y + (newCenterWorld.y - originalCenterWorld.y),
      };
      this.sceneGraph.update({ ...original, transform });
    }
  }

  // --- Gesture end -----------------------------------------------------------

  private commitGesture(): void {
    if (this.gestureChanged && this.dragSnapshots.size > 0) {
      const subCommands = Array.from(this.dragSnapshots.entries())
        .map(([id, previous]) => {
          const next = this.sceneGraph.get(id);
          return next ? new UpdateObjectCommand(this.sceneGraph, id, next, previous) : null;
        })
        .filter((command): command is UpdateObjectCommand => command !== null);
      if (subCommands.length > 0) {
        this.commands.execute(new CompositeCommand(subCommands));
      }
    }
    this.reset();
  }

  private revertGesture(): void {
    if (this.mode === "idle") return;
    for (const [id, original] of this.dragSnapshots) {
      if (this.sceneGraph.get(id)) this.sceneGraph.update(original);
    }
  }

  private reset(): void {
    this.activePointerId = null;
    this.mode = "idle";
    this.dragStart = null;
    this.dragSnapshots = new Map();
    this.gestureGeometry = null;
    this.grabbedHandle = null;
    this.gestureChanged = false;
  }

  // --- Text-box double-click editing (unchanged from select v1) --------------

  private maybeHandleDoubleClick(objectId: PageObjectId): void {
    const now = Date.now();
    const isDoubleClick =
      this.lastClickObjectId === objectId && now - this.lastClickTime <= DOUBLE_CLICK_WINDOW_MS;
    this.lastClickObjectId = objectId;
    this.lastClickTime = now;

    if (!isDoubleClick) return;

    const object = this.sceneGraph.get(objectId);
    if (!object || object.type !== "text-box" || this.editingObjectId === objectId) return;

    this.editingObjectId = objectId;
    // `object.bounds` is local (pre-transform) space — see Transform2D's own doc comment. A
    // text box that's been dragged since it was placed has a nonzero `transform.x/y` on top of
    // that unchanged local `bounds` (see `applyMove`, which only ever mutates `transform`, never
    // `bounds`), so emitting `bounds` directly here positioned the DOM overlay at the object's
    // ORIGINAL placement instead of wherever it was actually dragged to. `transformedBounds`
    // (the same helper `SceneGraph` uses for its own spatial index) composes the two correctly.
    this.textEditEvents.emit("text-edit:begin", {
      objectId,
      worldBounds: transformedBounds(object.bounds, object.transform),
      rotation: object.transform.rotation,
    });
  }

  private endEditing(): void {
    if (!this.editingObjectId) return;
    const objectId = this.editingObjectId;
    this.editingObjectId = null;
    this.textEditEvents.emit("text-edit:end", { objectId });
  }
}
