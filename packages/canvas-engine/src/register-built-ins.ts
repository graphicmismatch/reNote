import {
  identityTransform,
  newId,
  type AudioClipData,
  type Bounds,
  type ImageData,
  type PageObjectId,
  type ShapeData,
  type TextBoxData,
} from "@renote/core";
import { AddObjectCommand } from "./commands/object-commands.js";
import { recognizeShape, straightenStroke } from "./ink/ink-to-shape.js";
import { audioClipObjectType, type AudioClipObject } from "./objects/audio-clip-object-type.js";
import { fileAttachmentObjectType } from "./objects/file-attachment-object-type.js";
import { imageObjectType, type ImageObject } from "./objects/image-object-type.js";
import {
  boundsForStroke,
  inkStrokeObjectType,
  type InkStrokeEngineObject,
} from "./objects/ink-stroke-object-type.js";
import { shapeObjectType, type ShapeObject } from "./objects/shape-object-type.js";
import { tableObjectType } from "./objects/table-object-type.js";
import { linkButtonObjectType, type LinkButtonObject } from "./objects/link-button-object-type.js";
import { textBoxObjectType, type TextBoxObject } from "./objects/text-box-object-type.js";
import type { PageEngine } from "./PageEngine.js";
import { InkSettingsRegistry } from "./tools/ink-settings.js";
import { LassoSelectTool } from "./tools/lasso-select-tool.js";
import { PenTool, type PenToolOptions } from "./tools/pen-tool.js";
import { PixelEraserTool } from "./tools/pixel-eraser-tool.js";
import { SelectTool } from "./tools/select-tool.js";
import { ShapeTool } from "./tools/shape-tool.js";
import { StrokeEraserTool } from "./tools/stroke-eraser-tool.js";
import { TextBoxTool } from "./tools/text-box-tool.js";

/** Default highlighter styling — wider than the pen and a translucent yellow (ink-stroke's
 *  view already renders `tool: "highlighter"` at reduced opacity on top of this color). */
const DEFAULT_HIGHLIGHTER_COLOR = "#ffe066";
const DEFAULT_HIGHLIGHTER_WIDTH = 14;
const DEFAULT_PEN_COLOR = "#000000";
const DEFAULT_PEN_WIDTH = 2;
const DEFAULT_SHAPE_COLOR = "#000000";
const DEFAULT_SHAPE_WIDTH = 2;
/** Not a real color — erasers ignore `color`, but `InkToolSettings` always carries the field
 *  (see ink-settings.ts's doc comment on why it's one shape for every tool id). */
const ERASER_UNUSED_COLOR = "#000000";
const DEFAULT_PIXEL_ERASER_RADIUS = 10;
const DEFAULT_STROKE_ERASER_RADIUS = 8;

/**
 * Registers the built-in object types ("ink-stroke", "text-box", "shape", "image", "table",
 * "file-attachment", "link-button") on `engine.objectTypes`. `PageEngine` itself deliberately stays
 * type-agnostic — it has no idea any of these exist until a consumer calls this explicitly,
 * keeping the registries opt-in/composable instead of PageEngine silently hardcoding a fixed
 * built-in set.
 */
export function registerBuiltInObjectTypes(engine: PageEngine): void {
  engine.objectTypes.register(inkStrokeObjectType);
  engine.objectTypes.register(textBoxObjectType);
  engine.objectTypes.register(shapeObjectType);
  engine.objectTypes.register(imageObjectType);
  engine.objectTypes.register(tableObjectType);
  engine.objectTypes.register(fileAttachmentObjectType);
  engine.objectTypes.register(audioClipObjectType);
  engine.objectTypes.register(linkButtonObjectType);
}

/**
 * Registers the built-in tools on `engine.tools`: "select", "pen", "highlighter",
 * "stroke-eraser", "pixel-eraser", "lasso", one "shape-<kind>" per `ShapeKind`
 * ("shape-rectangle"/"shape-ellipse"/"shape-line"/"shape-arrow"), and "text-box". Does not
 * activate any of them — the caller decides which tool starts active, e.g.
 * `engine.tools.activate("select")`.
 *
 * The highlighter is a second `PenTool` instance (`toolId: "highlighter"`, `tool:
 * "highlighter"`), not a separate class — see `PenTool`'s doc comment and `PenToolOptions.toolId`.
 * `penOptions` still configures the plain "pen" instance only, exactly as before this phase;
 * existing 2-arg call sites (e.g. apps/desktop's PageEditorView) keep compiling unchanged.
 *
 * Also seeds `engine.inkSettings` with each color/size-bearing tool's starting values —
 * `InkSettingsRegistry.register` is a no-op once a tool id already has an entry, so calling
 * this on every `PageEngine` mount (once per page switch in `apps/desktop`) is safe even when
 * `engine.inkSettings` is a shared instance that outlives any single page's engine.
 */
export function registerBuiltInTools(engine: PageEngine, penOptions: PenToolOptions = {}): void {
  const ink = engine.inkSettings;
  engine.tools.register(
    new SelectTool(
      engine.scene,
      engine.selection,
      engine.commands,
      engine.objectTypes,
      () => engine.getCamera().zoom,
      engine.events,
    ),
  );

  ink.register("pen", {
    color: penOptions.color ?? DEFAULT_PEN_COLOR,
    width: penOptions.width ?? DEFAULT_PEN_WIDTH,
  });
  engine.tools.register(new PenTool(engine.scene, engine.commands, penOptions, ink, engine.objectTypes));

  ink.register("highlighter", { color: DEFAULT_HIGHLIGHTER_COLOR, width: DEFAULT_HIGHLIGHTER_WIDTH });
  engine.tools.register(
    new PenTool(
      engine.scene,
      engine.commands,
      {
        toolId: "highlighter",
        tool: "highlighter",
        color: DEFAULT_HIGHLIGHTER_COLOR,
        width: DEFAULT_HIGHLIGHTER_WIDTH,
      },
      ink,
      engine.objectTypes,
    ),
  );

  ink.register("stroke-eraser", { color: ERASER_UNUSED_COLOR, width: DEFAULT_STROKE_ERASER_RADIUS });
  engine.tools.register(new StrokeEraserTool(engine.scene, engine.commands, engine.objectTypes, {}, ink));

  ink.register("pixel-eraser", { color: ERASER_UNUSED_COLOR, width: DEFAULT_PIXEL_ERASER_RADIUS });
  engine.tools.register(new PixelEraserTool(engine.scene, engine.commands, {}, ink));

  engine.tools.register(new LassoSelectTool(engine.scene, engine.selection));
  for (const kind of ["rectangle", "ellipse", "line", "arrow"] as const) {
    ink.register(`shape-${kind}`, { color: DEFAULT_SHAPE_COLOR, width: DEFAULT_SHAPE_WIDTH });
    engine.tools.register(new ShapeTool(engine.scene, engine.commands, kind, {}, ink));
  }

  engine.tools.register(new TextBoxTool(engine.scene, engine.commands, engine.events));
}

/**
 * Creates a new, empty "cold" text box at the given page-space bounds and commits it through
 * `AddObjectCommand` (so it's undoable like any other mutation). `TextBoxTool` (the interactive
 * click/drag placement path) builds its own object literal directly rather than calling this,
 * since it also needs the bounds back before commit to emit "text-edit:begin"; this helper
 * remains the seam non-interactive callers use, e.g. the plain-text-file import flow in
 * `apps/desktop`. Returns the new object's id so the caller can immediately emit
 * "text-edit:begin" itself if it wants to drop straight into editing.
 */
export function createTextBox(engine: PageEngine, bounds: Bounds, content: unknown = ""): PageObjectId {
  const object: TextBoxObject = {
    id: newId<PageObjectId>(),
    type: "text-box",
    transform: identityTransform(),
    bounds,
    data: {
      content,
      backgroundColor: null,
      backgroundOpacity: 1,
      defaultTextColor: null,
    } satisfies TextBoxData,
  };
  engine.commands.execute(new AddObjectCommand(object));
  return object.id;
}

/**
 * Creates a new, target-less "link-button" object at the given page-space bounds and commits it
 * through `AddObjectCommand` (undoable like any other mutation — same shape as `createTextBox`
 * above). It spawns UNSET on purpose: the target is picked afterwards, from the link-target
 * popover `apps/desktop` opens over it (see the "link-edit:begin" event in text-edit-events.ts),
 * which is also how an existing button gets re-pointed later. Returns the new object's id.
 */
export function createLinkButton(engine: PageEngine, bounds: Bounds): PageObjectId {
  const object: LinkButtonObject = {
    id: newId<PageObjectId>(),
    type: "link-button",
    transform: identityTransform(),
    bounds,
    data: { target: null },
  };
  engine.commands.execute(new AddObjectCommand(object));
  return object.id;
}

/**
 * Creates a new "image" object at the given page-space bounds and commits it through
 * `AddObjectCommand` (so inserting an image is undoable like any other mutation, for free —
 * see `createTextBox`'s doc comment, which this mirrors exactly). `data.assetPath` must already
 * point at bytes actually saved on disk — this helper does no I/O of its own; `apps/desktop`'s
 * "Insert Image" toolbar action calls `StorageClient.saveImageAsset` first (and measures
 * `naturalWidth`/`naturalHeight` client-side via `createImageBitmap`, per this phase's design —
 * see `image-object-type.ts`'s doc comments), then calls this with the resulting `ImageData`.
 * Returns the new object's id.
 */
export function createImageObject(engine: PageEngine, bounds: Bounds, data: ImageData): PageObjectId {
  const object: ImageObject = {
    id: newId<PageObjectId>(),
    type: "image",
    transform: identityTransform(),
    bounds,
    data: imageObjectType.validate(data),
  };
  engine.commands.execute(new AddObjectCommand(object));
  return object.id;
}

/** Spawns an "audio-clip" object for a just-recorded/saved clip. Same shape as
 *  `createImageObject` above. */
export function createAudioClipObject(engine: PageEngine, bounds: Bounds, data: AudioClipData): PageObjectId {
  const object: AudioClipObject = {
    id: newId<PageObjectId>(),
    type: "audio-clip",
    transform: identityTransform(),
    bounds,
    data: audioClipObjectType.validate(data),
  };
  engine.commands.execute(new AddObjectCommand(object));
  return object.id;
}

/**
 * "Convert to Shape" context-menu action: runs the same `recognizeShape` heuristic `PenTool`
 * runs live, applied after the fact to an already-committed ink stroke. Pure — returns the new
 * `ShapeObject` (same transform as the source stroke) or null on no match; callers wrap the
 * result in their own `RemoveObjectCommand`+`AddObjectCommand` pair so converting a multi-object
 * selection stays one undo step (see AppShell's `handleConvertToShape`).
 */
export function convertInkStrokeToShape(stroke: InkStrokeEngineObject): ShapeObject | null {
  const recognized = recognizeShape(stroke.data.points);
  if (!recognized) return null;
  return {
    id: newId<PageObjectId>(),
    type: "shape",
    transform: stroke.transform,
    bounds: recognized.bounds,
    data: {
      kind: recognized.kind,
      strokeColor: stroke.data.color,
      strokeWidth: stroke.data.width,
      fillColor: null,
      startPoint: recognized.startPoint,
      endPoint: recognized.endPoint,
    } satisfies ShapeData,
  };
}

/**
 * "Straighten Stroke" context-menu action: snaps a near-collinear ink stroke's points onto its
 * chord via `straightenStroke`, recomputing `bounds` to match. Pure — returns the updated object
 * or null when the stroke isn't straight enough to qualify; callers wrap the result in their own
 * `UpdateObjectCommand` (see AppShell's `handleStraightenStroke`).
 */
export function straightenInkStroke(stroke: InkStrokeEngineObject): InkStrokeEngineObject | null {
  const straightened = straightenStroke(stroke.data.points);
  if (!straightened) return null;
  const points = [straightened.start, straightened.end];
  return {
    ...stroke,
    bounds: boundsForStroke(points, stroke.data.width),
    data: { ...stroke.data, points },
  };
}
