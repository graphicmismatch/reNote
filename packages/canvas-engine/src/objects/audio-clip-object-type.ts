import { Container, Graphics, Text } from "pixi.js";
import type { AudioClipData, AudioClipObject } from "@renote/core";
import type { ChunkOrigin, ObjectTypeDefinition } from "./object-type-definition.js";

// Re-exported so callers can `import { AudioClipObject } from "@renote/canvas-engine"` without
// also reaching into "@renote/core" — same pattern as file-attachment-object-type.ts's re-export.
export type { AudioClipObject, AudioClipData };

const BORDER_COLOR = 0xb0b0b0;
const GLYPH_COLOR = 0x707070;
const LABEL_COLOR = 0x3a3a3a;
const TRACK_COLOR = 0xd0d0d0;

function validateAudioClipData(data: unknown): AudioClipData {
  if (typeof data !== "object" || data === null) {
    throw new Error("audio-clip data must be an object.");
  }
  const candidate = data as Record<string, unknown>;
  if (typeof candidate.assetPath !== "string") {
    throw new Error("audio-clip data.assetPath must be a string.");
  }
  if (typeof candidate.durationSeconds !== "number" || candidate.durationSeconds < 0) {
    throw new Error("audio-clip data.durationSeconds must be a non-negative number.");
  }
  return { assetPath: candidate.assetPath, durationSeconds: candidate.durationSeconds };
}

/** Formats a duration in seconds as `m:ss`, e.g. `65` -> `"1:05"`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`formatDuration expects a non-negative finite number, got ${seconds}.`);
  }
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/** `AudioClipData` carries no `fileName` of its own (see the plan's "do not invent new fields") —
 *  the display name is the last path segment of `assetPath`, the same file `write_asset` wrote. */
function fileNameOf(assetPath: string): string {
  return assetPath.split("/").pop() ?? assetPath;
}

interface AudioClipView extends Container {
  border: Graphics;
  playGlyph: Graphics;
  track: Graphics;
  durationLabel: Text;
}

function isAudioClipView(view: Container): view is AudioClipView {
  return "border" in view && "playGlyph" in view && "track" in view && "durationLabel" in view;
}

export const audioClipObjectType: ObjectTypeDefinition<"audio-clip", AudioClipData> = {
  type: "audio-clip",

  validate: validateAudioClipData,

  createView(object, origin): Container {
    const container = new Container() as AudioClipView;
    const border = new Graphics();
    const playGlyph = new Graphics();
    const track = new Graphics();
    const durationLabel = new Text({ text: "", style: { fontSize: 11, fill: LABEL_COLOR } });
    container.addChild(border);
    container.addChild(track);
    container.addChild(playGlyph);
    container.addChild(durationLabel);
    container.border = border;
    container.playGlyph = playGlyph;
    container.track = track;
    container.durationLabel = durationLabel;
    drawAudioClipView(container, object, origin);
    return container;
  },

  updateView(view, object, origin): void {
    if (isAudioClipView(view)) {
      drawAudioClipView(view, object, origin);
    }
  },

  hitTest(object, point): boolean {
    const { x, y, width, height } = object.bounds;
    return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
  },

  supportsRotation: false,
  supportsResize: false,
};

const WELL_MARGIN = 6;
const WELL_SIZE = 20;
const TICK_COUNT = 8;

/**
 * Geometry only, no waveform — see `object-type-definition.ts`'s `ChunkOrigin` doc comment for
 * why `origin` is subtracted before drawing. A cold affordance: play state lives entirely in the
 * DOM `<audio>` overlay `PageEditorView` mounts on click, never on this view or on
 * `AudioClipData` (would dirty the page and re-fire the save debounce every frame — see the
 * plan's Appendix B).
 */
function drawAudioClipView(view: AudioClipView, object: AudioClipObject, origin: ChunkOrigin): void {
  const x = object.bounds.x - origin.x;
  const y = object.bounds.y - origin.y;
  const { width, height } = object.bounds;

  view.border.clear();
  view.border.rect(x, y, width, height).stroke({ width: 1, color: BORDER_COLOR });

  const wellX = x + WELL_MARGIN;
  const wellY = y + (height - WELL_SIZE) / 2;
  view.playGlyph.clear();
  view.playGlyph.rect(wellX, wellY, WELL_SIZE, WELL_SIZE).stroke({ width: 1, color: GLYPH_COLOR });
  const triSize = WELL_SIZE * 0.4;
  const cx = wellX + WELL_SIZE / 2;
  const cy = wellY + WELL_SIZE / 2;
  view.playGlyph
    .moveTo(cx - triSize / 2, cy - triSize / 2)
    .lineTo(cx - triSize / 2, cy + triSize / 2)
    .lineTo(cx + triSize / 2, cy)
    .closePath()
    .fill(GLYPH_COLOR);

  const trackX = wellX + WELL_SIZE + WELL_MARGIN;
  const trackEndX = x + width - WELL_MARGIN;
  const trackY = y + height / 2 + 6;
  view.track.clear();
  view.track.moveTo(trackX, trackY).lineTo(trackEndX, trackY).stroke({ width: 1, color: TRACK_COLOR });
  const span = Math.max(trackEndX - trackX, 0);
  for (let i = 0; i <= TICK_COUNT; i += 1) {
    const tickX = trackX + (span * i) / TICK_COUNT;
    view.track
      .moveTo(tickX, trackY - 2)
      .lineTo(tickX, trackY + 2)
      .stroke({ width: 1, color: TRACK_COLOR });
  }

  view.durationLabel.text = `${formatDuration(object.data.durationSeconds)}  ${fileNameOf(object.data.assetPath)}`;
  view.durationLabel.position.set(trackX, y + height / 2 - 14);
}
