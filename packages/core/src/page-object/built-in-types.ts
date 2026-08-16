import type { PageObject } from "./envelope.js";

/** Stable identifiers for the object types shipped by default; registered like any other type. */
export const BUILT_IN_OBJECT_TYPES = [
  "text-box",
  "ink-stroke",
  "image",
  "shape",
  "table",
  "file-attachment",
  "audio-clip",
  "link-button",
] as const;

export type BuiltInObjectType = (typeof BUILT_IN_OBJECT_TYPES)[number];

export interface TextBoxData {
  /** Rich-text document produced by packages/text-editor's schema. */
  content: unknown;
  /**
   * The text box's own fill color, independent of any tag or in-text mark — freely settable via
   * the floating toolbar shown while editing. `null` = no fill (transparent), matching
   * `ShapeData.fillColor`'s same "null means none" convention.
   */
  backgroundColor: string | null;
  /** 0 (fully transparent) to 1 (fully opaque); meaningless while `backgroundColor` is null. */
  backgroundOpacity: number;
  /**
   * Base text color for any run that carries no explicit `textColor` mark (see
   * packages/text-editor's schema). `null` = use the view's own default foreground.
   */
  defaultTextColor: string | null;
}

export interface InkStrokeData {
  tool: "pen" | "highlighter";
  color: string;
  /** Base stroke width in page units before pressure modulation. */
  width: number;
  /** Reference to the packed point-data blob under the page's assets/strokes folder. */
  pointDataAssetPath: string;
}

export interface ImageData {
  assetPath: string;
  naturalWidth: number;
  naturalHeight: number;
  cropRect: { x: number; y: number; width: number; height: number } | null;
}

export type ShapeKind = "rectangle" | "ellipse" | "line" | "arrow";

export interface ShapeData {
  kind: ShapeKind;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string | null;
  /**
   * The actual drag endpoints in page space, meaningful only for kind "line"/"arrow".
   * `bounds` alone (the envelope's axis-aligned box) can't tell a drag that went
   * top-left-to-bottom-right apart from one that went bottom-left-to-top-right — both
   * produce the same box — so a line/arrow's true direction has to be stored explicitly
   * rather than reconstructed from `bounds`' corners.
   */
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
}

export interface TableData {
  columnWidths: number[];
  rowHeights: number[];
  /** Row-major cell content; each cell is a rich-text document like TextBoxData.content. */
  cells: unknown[][];
  mergedRanges: { row: number; col: number; rowSpan: number; colSpan: number }[];
}

export interface FileAttachmentData {
  assetPath: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
}

export interface AudioClipData {
  assetPath: string;
  durationSeconds: number;
}

/**
 * Where a `link-button` points. The field names are deliberately the ones a `wikilink` text mark
 * uses (`kind`/`attr`/`attr2`/`attr3` — see packages/text-editor's `TextMark`), NOT the plainer
 * `pageId`/`label`/`anchor` they would otherwise have: `renote-index`'s Rust-side
 * `extract_wikilink_targets` finds a page's links by walking its object data for exactly this
 * shape, wherever it appears. Matching it means a link button counts as a real link — Linked
 * Mentions and the graph view see it — with no change to the index, the commands, or any DTO.
 */
export interface LinkButtonTarget {
  kind: "wikilink";
  /** Target page id. */
  attr: string;
  /** Text shown on the button — the target page's title as of when the link was made. */
  attr2: string;
  /** Optional heading within the target page to land on. */
  attr3?: string;
}

/**
 * A standalone navigation button: a page object whose entire content is a link, with no text to
 * type into. Distinct from a wikilink typed inside a text box (that stays a text mark) — this is
 * the object the "Insert Link" toolbar button spawns.
 */
export interface LinkButtonData {
  /** `null` until a target is picked — a freshly spawned button is an unset placeholder. */
  target: LinkButtonTarget | null;
}

export type TextBoxObject = PageObject<"text-box", TextBoxData>;
export type InkStrokeObject = PageObject<"ink-stroke", InkStrokeData>;
export type ImageObject = PageObject<"image", ImageData>;
export type ShapeObject = PageObject<"shape", ShapeData>;
export type TableObject = PageObject<"table", TableData>;
export type FileAttachmentObject = PageObject<"file-attachment", FileAttachmentData>;
export type AudioClipObject = PageObject<"audio-clip", AudioClipData>;
export type LinkButtonObject = PageObject<"link-button", LinkButtonData>;

/** Convenience union for exhaustive switches over the built-in types; registry-added types fall outside it. */
export type BuiltInPageObject =
  | TextBoxObject
  | InkStrokeObject
  | ImageObject
  | ShapeObject
  | TableObject
  | FileAttachmentObject
  | AudioClipObject
  | LinkButtonObject;
