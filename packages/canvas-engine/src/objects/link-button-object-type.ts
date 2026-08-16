import { Container, Graphics, Text } from "pixi.js";
import type { LinkButtonData, LinkButtonObject, LinkButtonTarget } from "@renote/core";
import type { ChunkOrigin, ObjectTypeDefinition } from "./object-type-definition.js";

// Re-exported so callers can import these from "@renote/canvas-engine" without also reaching
// into "@renote/core" — same pattern as text-box/file-attachment's re-exports.
export type { LinkButtonData, LinkButtonObject, LinkButtonTarget };

/** Matches `index.css`'s `a[data-wikilink]` and `text-box-object-type.ts`'s `LINK_COLOR`, so
 *  every link in the app reads as the same thing. */
const LINK_COLOR = 0x1e5fd9;
const FILL_COLOR = 0xe6f2ff;
/** An unset button (no target picked yet) is drawn muted, so a placeholder never looks like a
 *  working link. */
const UNSET_COLOR = 0x8a8a8a;
const UNSET_FILL_COLOR = 0xf0f0f0;
const LABEL_PADDING_X = 10;
const ARROW_SIZE = 9;

/** Shown until a target is picked. */
export const LINK_BUTTON_PLACEHOLDER = "Choose a page…";

function validateTarget(value: unknown): LinkButtonTarget | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") {
    throw new Error("link-button data.target must be an object or null.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== "wikilink") {
    throw new Error('link-button data.target.kind must be "wikilink".');
  }
  if (typeof candidate.attr !== "string" || candidate.attr === "") {
    throw new Error("link-button data.target.attr must be a non-empty target page id.");
  }
  const target: LinkButtonTarget = {
    kind: "wikilink",
    attr: candidate.attr,
    attr2: typeof candidate.attr2 === "string" ? candidate.attr2 : "",
  };
  return typeof candidate.attr3 === "string" && candidate.attr3 !== ""
    ? { ...target, attr3: candidate.attr3 }
    : target;
}

function validateLinkButtonData(data: unknown): LinkButtonData {
  if (typeof data !== "object" || data === null) {
    throw new Error("link-button data must be an object.");
  }
  return { target: validateTarget((data as { target?: unknown }).target) };
}

/** What the button reads: the target's title, plus its heading when the link points at one. */
export function linkButtonLabel(data: LinkButtonData): string {
  if (!data.target) return LINK_BUTTON_PLACEHOLDER;
  const title = data.target.attr2 === "" ? "Untitled page" : data.target.attr2;
  return data.target.attr3 ? `${title} › ${data.target.attr3}` : title;
}

/**
 * A button wide enough for `label` at the view's font size. Callers size a button with this when
 * its target is set, since the button has no text cursor to autosize from the way a text box does
 * (see `PageEditorView`'s autosize `ResizeObserver`) and a fixed width would either clip a long
 * page title or leave a short one swimming in empty space.
 */
export function linkButtonWidthFor(label: string): number {
  const estimated = ARROW_SIZE + LABEL_PADDING_X * 3 + label.length * 7;
  return Math.min(360, Math.max(140, estimated));
}

interface LinkButtonView extends Container {
  background: Graphics;
  arrow: Graphics;
  caption: Text;
  /** Last text handed to `label`, so `drawLinkButtonView` can skip redundant reassignment on the
   *  many updates that only move the object. */
  lastLabel: string;
}

function isLinkButtonView(view: Container): view is LinkButtonView {
  return "background" in view && "arrow" in view && "caption" in view;
}

/**
 * A standalone navigation button — the object "Insert Link" spawns. It holds a link target and
 * nothing else: there is no text to type into, which is the whole point of it being its own type
 * rather than a text box that happens to contain one wikilink.
 *
 * Rotation and resize are both off: this is a fixed affordance like `file-attachment`, sized from
 * its own label (see `linkButtonWidthFor`). A rotated or hand-stretched navigation button would
 * only make the label harder to read and its click target harder to explain.
 */
export const linkButtonObjectType: ObjectTypeDefinition<"link-button", LinkButtonData> = {
  type: "link-button",

  validate: validateLinkButtonData,

  createView(object, origin): Container {
    const container = new Container() as LinkButtonView;
    const background = new Graphics();
    const arrow = new Graphics();
    const caption = new Text({
      text: "",
      style: { fontFamily: "sans-serif", fontSize: 13, fill: LINK_COLOR },
    });
    container.addChild(background);
    container.addChild(arrow);
    container.addChild(caption);
    container.background = background;
    container.arrow = arrow;
    container.caption = caption;
    container.lastLabel = "";
    drawLinkButtonView(container, object, origin);
    return container;
  },

  updateView(view, object, origin): void {
    if (isLinkButtonView(view)) {
      drawLinkButtonView(view, object, origin);
    }
  },

  hitTest(object, point): boolean {
    const { x, y, width, height } = object.bounds;
    return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
  },

  supportsRotation: false,
  supportsResize: false,
};

/**
 * Geometry is baked in chunk-local space: `object.bounds` (world space) minus `origin` — see
 * `ChunkOrigin`'s doc comment. Draws a filled, thick-bordered plate with a right-pointing arrow
 * glyph and the target's label, so it reads as a button at a glance rather than as a text box.
 */
function drawLinkButtonView(view: LinkButtonView, object: LinkButtonObject, origin: ChunkOrigin): void {
  const x = object.bounds.x - origin.x;
  const y = object.bounds.y - origin.y;
  const { width, height } = object.bounds;
  const isSet = object.data.target !== null;
  const color = isSet ? LINK_COLOR : UNSET_COLOR;

  view.background.clear();
  view.background
    .rect(x, y, width, height)
    .fill({ color: isSet ? FILL_COLOR : UNSET_FILL_COLOR })
    .stroke({ width: 2, color });

  // "→" as geometry rather than a glyph in the label, so it stays crisp at any zoom and never
  // depends on the platform font having the character.
  const arrowY = y + height / 2;
  const arrowX = x + LABEL_PADDING_X;
  view.arrow.clear();
  view.arrow
    .moveTo(arrowX, arrowY)
    .lineTo(arrowX + ARROW_SIZE, arrowY)
    .moveTo(arrowX + ARROW_SIZE - 4, arrowY - 4)
    .lineTo(arrowX + ARROW_SIZE, arrowY)
    .lineTo(arrowX + ARROW_SIZE - 4, arrowY + 4)
    .stroke({ width: 2, color });

  const label = linkButtonLabel(object.data);
  if (view.lastLabel !== label) {
    view.caption.text = label;
    view.lastLabel = label;
  }
  view.caption.style.fill = color;
  view.caption.position.set(arrowX + ARROW_SIZE + LABEL_PADDING_X, arrowY - view.caption.height / 2);
}
