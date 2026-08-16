import { Container, Graphics, Text } from "pixi.js";
import type { FileAttachmentData, FileAttachmentObject } from "@renote/core";
import type { ChunkOrigin, ObjectTypeDefinition } from "./object-type-definition.js";

// Re-exported so callers can `import { FileAttachmentObject } from "@renote/canvas-engine"`
// without also reaching into "@renote/core" — same pattern as text-box-object-type.ts's
// re-export, since FileAttachmentObject/FileAttachmentData carry no engine-only fields.
export type { FileAttachmentObject, FileAttachmentData };

const BORDER_COLOR = 0xb0b0b0;
const ICON_COLOR = 0x707070;
const LABEL_COLOR = 0x3a3a3a;
const SIZE_LABEL_COLOR = 0x9a9a9a;

function validateFileAttachmentData(data: unknown): FileAttachmentData {
  if (typeof data !== "object" || data === null) {
    throw new Error("file-attachment data must be an object.");
  }
  const candidate = data as Record<string, unknown>;
  if (typeof candidate.assetPath !== "string") {
    throw new Error("file-attachment data.assetPath must be a string.");
  }
  if (typeof candidate.fileName !== "string") {
    throw new Error("file-attachment data.fileName must be a string.");
  }
  if (typeof candidate.fileSizeBytes !== "number" || candidate.fileSizeBytes < 0) {
    throw new Error("file-attachment data.fileSizeBytes must be a non-negative number.");
  }
  if (typeof candidate.mimeType !== "string") {
    throw new Error("file-attachment data.mimeType must be a string.");
  }
  return {
    assetPath: candidate.assetPath,
    fileName: candidate.fileName,
    fileSizeBytes: candidate.fileSizeBytes,
    mimeType: candidate.mimeType,
  };
}

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Formats a byte count as a compact human-readable string, e.g. "0 B", "1 KB", "12.3 KB",
 * "4.1 MB". Uses base-1024 units (KB/MB/... are binary, matching how OneNote/most file managers
 * display attachment sizes) and rounds to one decimal place once past the first unit — whole
 * bytes are shown without a decimal.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new Error(`formatFileSize expects a non-negative finite number, got ${bytes}.`);
  }

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  // Rounding for display can push the rounded value back up to (or past) 1024 at the current
  // unit — e.g. 1023.6 bytes rounds to "1024 B", and 1048575 bytes (1 MB minus 1 byte) rounds
  // to "1024.0 KB". Re-check the rollover condition against the *rounded* value, not the raw
  // one, so the result always renders in the next unit instead of an out-of-range "1024...".
  let rounded = unitIndex === 0 ? Math.round(value) : Number(value.toFixed(1));
  while (rounded >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
    rounded = unitIndex === 0 ? Math.round(value) : Number(value.toFixed(1));
  }

  return unitIndex === 0 ? `${rounded} B` : `${rounded.toFixed(1)} ${SIZE_UNITS[unitIndex]}`;
}

interface FileAttachmentView extends Container {
  border: Graphics;
  icon: Graphics;
  nameLabel: Text;
  sizeLabel: Text;
}

function isFileAttachmentView(view: Container): view is FileAttachmentView {
  return "border" in view && "icon" in view && "nameLabel" in view && "sizeLabel" in view;
}

export const fileAttachmentObjectType: ObjectTypeDefinition<"file-attachment", FileAttachmentData> = {
  type: "file-attachment",

  validate: validateFileAttachmentData,

  createView(object, origin): Container {
    const container = new Container() as FileAttachmentView;
    const border = new Graphics();
    const icon = new Graphics();
    const nameLabel = new Text({
      text: "",
      style: { fontSize: 12, fill: LABEL_COLOR },
    });
    const sizeLabel = new Text({
      text: "",
      style: { fontSize: 10, fill: SIZE_LABEL_COLOR },
    });
    container.addChild(border);
    container.addChild(icon);
    container.addChild(nameLabel);
    container.addChild(sizeLabel);
    container.border = border;
    container.icon = icon;
    container.nameLabel = nameLabel;
    container.sizeLabel = sizeLabel;
    drawFileAttachmentView(container, object, origin);
    return container;
  },

  updateView(view, object, origin): void {
    if (isFileAttachmentView(view)) {
      drawFileAttachmentView(view, object, origin);
    }
  },

  hitTest(object, point): boolean {
    const { x, y, width, height } = object.bounds;
    return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
  },

  supportsRotation: false,
  supportsResize: false,
};

const ICON_MARGIN = 6;
const ICON_SIZE = 20;

/**
 * Geometry is baked in chunk-local space: `object.bounds` (world space) minus `origin` (the
 * containing chunk's world-space offset — see PixiRenderer's chunk-container doc comment) —
 * `PixiRenderer` applies `transform.x/y/rotation/scale` on top generically, this function never
 * touches those.
 */
function drawFileAttachmentView(
  view: FileAttachmentView,
  object: FileAttachmentObject,
  origin: ChunkOrigin,
): void {
  const x = object.bounds.x - origin.x;
  const y = object.bounds.y - origin.y;
  const { width, height } = object.bounds;

  view.border.clear();
  view.border.rect(x, y, width, height).stroke({ width: 1, color: BORDER_COLOR });

  // Compact "file icon": a small dog-eared-rectangle glyph on the left of the fixed-size affordance.
  view.icon.clear();
  const iconX = x + ICON_MARGIN;
  const iconY = y + (height - ICON_SIZE) / 2;
  const fold = 6;
  view.icon
    .moveTo(iconX, iconY)
    .lineTo(iconX + ICON_SIZE - fold, iconY)
    .lineTo(iconX + ICON_SIZE, iconY + fold)
    .lineTo(iconX + ICON_SIZE, iconY + ICON_SIZE)
    .lineTo(iconX, iconY + ICON_SIZE)
    .lineTo(iconX, iconY)
    .stroke({ width: 1, color: ICON_COLOR })
    .moveTo(iconX + ICON_SIZE - fold, iconY)
    .lineTo(iconX + ICON_SIZE - fold, iconY + fold)
    .lineTo(iconX + ICON_SIZE, iconY + fold)
    .stroke({ width: 1, color: ICON_COLOR });

  const textX = iconX + ICON_SIZE + ICON_MARGIN;
  view.nameLabel.text = object.data.fileName;
  view.nameLabel.position.set(textX, y + height / 2 - 12);

  view.sizeLabel.text = formatFileSize(object.data.fileSizeBytes);
  view.sizeLabel.position.set(textX, y + height / 2 + 2);
}
