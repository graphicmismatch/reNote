import { identityTransform, newId, type Bounds, type PageObjectId, type TextBoxData } from "@renote/core";
import type { CommandStack } from "../commands/command-stack.js";
import { AddObjectCommand } from "../commands/object-commands.js";
import type { TextBoxObject } from "../objects/text-box-object-type.js";
import type { SceneGraph } from "../scene/scene-graph.js";
import type { NormalizedPointerEvent } from "../input/pointer-event.js";
import type { PageEngineEventBus } from "../text-edit-events.js";
import type { Tool } from "./tool.js";

/** Used when a user clicks without dragging — a sensible starting size to type into,
 *  OneNote-style "click and type" placement rather than forcing a manual size first. */
const DEFAULT_WIDTH = 220;
const DEFAULT_HEIGHT = 32;
/** Below this drag diagonal (page units), treat the gesture as a plain click. */
const MIN_DRAG_DIAGONAL = 4;

/**
 * Click (or click-drag) to place a new "text-box" object, then immediately drops into editing —
 * emitting "text-edit:begin" the same way `SelectTool` does on a double-click of an EXISTING
 * text box, so placing one is never a dead end the user has to know to double-click afterward.
 *
 * `register-built-ins.ts`'s `createTextBox` helper existed before this tool (used by the plain-
 * text-file import flow) but nothing ever let a user place a text box by hand — seams (rich
 * text, wikilinks, paragraph tags) were fully built downstream with no way to reach them from
 * the canvas itself. This tool is that missing entry point.
 */
export class TextBoxTool implements Tool {
  readonly id = "text-box";
  readonly cursor = "text";

  private activePointerId: number | null = null;
  private start: { x: number; y: number } | null = null;
  private livePreviewId: PageObjectId | null = null;

  constructor(
    private readonly scene: SceneGraph,
    private readonly commands: CommandStack<SceneGraph>,
    private readonly textEditEvents: PageEngineEventBus,
  ) {}

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
    this.commitTextBox(event);
  }

  onCancel(): void {
    this.clearLivePreview();
    this.reset();
  }

  private boundsFor(start: { x: number; y: number }, end: { x: number; y: number }): Bounds {
    const dragged: Bounds = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
    if (Math.hypot(dragged.width, dragged.height) < MIN_DRAG_DIAGONAL) {
      return { x: start.x, y: start.y, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
    }
    return dragged;
  }

  private buildObject(id: PageObjectId, bounds: Bounds): TextBoxObject {
    return {
      id,
      type: "text-box",
      transform: identityTransform(),
      bounds,
      data: {
        content: "",
        backgroundColor: null,
        backgroundOpacity: 1,
        defaultTextColor: null,
      } satisfies TextBoxData,
    };
  }

  private renderLivePreview(event: NormalizedPointerEvent): void {
    if (!this.start || !this.livePreviewId) return;
    const bounds = this.boundsFor(this.start, { x: event.x, y: event.y });
    const object = this.buildObject(this.livePreviewId, bounds);
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

  private commitTextBox(event: NormalizedPointerEvent): void {
    this.clearLivePreview();
    if (this.start) {
      const bounds = this.boundsFor(this.start, { x: event.x, y: event.y });
      const object = this.buildObject(newId<PageObjectId>(), bounds);
      this.commands.execute(new AddObjectCommand(object));
      // A freshly placed box always starts with `identityTransform()` (see `buildObject`), so
      // `rotation` is always 0 here — reading it off `object.transform` rather than hardcoding
      // keeps this in sync automatically if that ever stops being true.
      this.textEditEvents.emit("text-edit:begin", {
        objectId: object.id,
        worldBounds: bounds,
        rotation: object.transform.rotation,
      });
    }
    this.reset();
  }

  private reset(): void {
    this.activePointerId = null;
    this.start = null;
    this.livePreviewId = null;
  }
}
