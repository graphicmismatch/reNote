import { Container, Graphics, HTMLText } from "pixi.js";
import type { TextBoxData, TextBoxObject } from "@renote/core";
import type { ChunkOrigin, ObjectTypeDefinition } from "./object-type-definition.js";

// Re-exported so callers can `import { TextBoxObject } from "@renote/canvas-engine"` without
// also reaching into "@renote/core" — this is the exact same type (@renote/core's own
// TextBoxObject), not a locally-widened one, unlike ink-stroke's InkStrokeEngineObject which
// really does carry extra engine-internal fields core's InkStrokeObject doesn't have.
export type { TextBoxObject };

/** Default (unmarked, no `TextBoxData.defaultTextColor` override) text color for real, typed
 *  content — distinct from the old single `PLACEHOLDER_TEXT_COLOR` this replaces: that constant
 *  was used for every text box regardless of whether it actually had content, since the old
 *  plain-text preview couldn't tell "real formatted content" apart from "nothing typed yet"
 *  visually anyway. Now that the cold view renders real formatting, real content should look like
 *  real content (close to the live editor's own near-black foreground), not like a placeholder. */
const DEFAULT_TEXT_COLOR = "#1a1a1a";
const BORDER_COLOR = "#b0b0b0";
/** Wikilink text in the cold view — matches `index.css`'s `a[data-wikilink]` color, so a link
 *  looks the same whether the box is being edited or not. */
const LINK_COLOR = "#1e5fd9";

/** HTML-escapes the five characters that would otherwise corrupt the generated markup or let
 *  user-typed text (or a pasted `alt`/`src`) break out of an attribute value — used for every
 *  piece of raw string content (`extractRunHtml`/`extractBlockHtml` below) before it's spliced
 *  into an HTML string, not just for visual fidelity but for correctness: an untreated `<`/`&`
 *  in typed text would otherwise silently corrupt the structure of everything after it. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * One run within a paragraph block — either a plain text run (wrapped in the HTML tag(s)
 * matching whichever marks it carries, mirroring `prosemirror-schema.ts`'s own `toDOM` output so
 * cold and live rendering share the same markup shape) or an image run (`<img>`). Duck-typed
 * against `unknown`, not `RichTextRun`/`RichTextRun["marks"]` — see `extractBlockHtml`'s doc
 * comment for why canvas-engine can't import those types directly.
 */
function extractRunHtml(run: unknown): string {
  if (typeof run !== "object" || run === null) return "";
  if ((run as { kind?: unknown }).kind === "image") {
    const src = (run as { src?: unknown }).src;
    const alt = (run as { alt?: unknown }).alt;
    if (typeof src !== "string") return "";
    const altText = typeof alt === "string" ? alt : "";
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(altText)}" style="max-width:100%;max-height:120px;vertical-align:middle" />`;
  }
  const text = (run as { text?: unknown }).text;
  if (typeof text !== "string" || text.length === 0) return "";
  const marks = (run as { marks?: unknown }).marks;
  let html = escapeHtml(text);
  if (Array.isArray(marks)) {
    // Only the marks that visibly change rendering in a useful, cheaply-reproducible way — see
    // the project's markdown-support plan's "Deferred" list for the same reasoning applied to
    // link/wikilink/highlight staying plain text here (out of scope for this pass).
    for (const mark of marks) {
      if (typeof mark !== "object" || mark === null) continue;
      const kind = (mark as { kind?: unknown }).kind;
      if (kind === "bold") html = `<strong>${html}</strong>`;
      else if (kind === "italic") html = `<em>${html}</em>`;
      else if (kind === "strikethrough") html = `<s>${html}</s>`;
      else if (kind === "code") html = `<code>${html}</code>`;
      else if (kind === "wikilink") {
        // Links used to render as indistinguishable plain text here (deliberately deferred at
        // the time), which stopped mattering once a cold text box became clickable — see
        // `PageEditorView`'s canvas link-follow handler. A reader has to be able to SEE that
        // something is a link before clicking it, so this is the minimum that reads as one.
        html = `<span style="color:${LINK_COLOR};text-decoration:underline">${html}</span>`;
      } else if (kind === "textColor") {
        const color = (mark as { attr?: unknown }).attr;
        if (typeof color === "string" && color.length > 0) {
          html = `<span style="color:${escapeHtml(color)}">${html}</span>`;
        }
      }
    }
  }
  return html;
}

/** One row of a `"table"` block — cells are themselves paragraph-shaped blocks, so this recurses
 *  back into `extractBlockHtml` per cell rather than duplicating its run-walking logic.
 *  `isHeaderRow` bolds every cell in the row inline (mirroring `index.css`'s `tr:first-child td`
 *  rule) rather than relying on a `:first-child` selector matching correctly inside `HTMLText`'s
 *  isolated rendering context. */
function extractTableRowHtml(row: unknown, isHeaderRow: boolean): string {
  if (typeof row !== "object" || row === null || !("cells" in row)) return "";
  const cells = (row as { cells: unknown }).cells;
  if (!Array.isArray(cells)) return "";
  const cellStyle = isHeaderRow
    ? `border:1px solid ${BORDER_COLOR};padding:2px 6px;font-weight:600`
    : `border:1px solid ${BORDER_COLOR};padding:2px 6px`;
  return `<tr>${cells.map((cell) => `<td style="${cellStyle}">${extractBlockHtml(cell)}</td>`).join("")}</tr>`;
}

/**
 * Real (not stripped-to-plain-text) HTML rendering for the "cold" (non-editing) preview, fed
 * into a Pixi `HTMLText` node (see `createView`/`drawTextBoxView` below) — this is what lets
 * bold/italic/headings/blockquotes/code/tables/images/text-color survive a text box being
 * deselected, not just plain characters. Still not a real rich-text-to-DOM renderer owned by this
 * package: `packages/text-editor` owns the actual schema, and canvas-engine cannot import its
 * `RichTextDocument` type (boundary-lint: canvas-engine may only depend on `@renote/core`), so
 * the real `{ paragraphs: [...] }` shape `RichTextField` actually saves (see
 * `PageEditorView.tsx`'s `endTextEdit`) is duck-typed here instead, alongside the legacy
 * `{ text: string }`/bare-string shapes — mirroring the markup `prosemirror-schema.ts`'s `toDOM`
 * functions produce closely enough that cold and live rendering stay visually consistent, without
 * the two ever sharing code.
 *
 * Each element of `paragraphs` is one of three block kinds, discriminated by an (optionally
 * absent, for old paragraph-only data) `kind` field — `"paragraph"` (default when absent),
 * `"codeBlock"`, or `"table"` — mirroring `RichTextBlock`'s discriminated union in
 * packages/text-editor/src/schema/marks.ts, which this function cannot import directly for the
 * boundary-lint reason above. List markers (bulleted/numbered) are intentionally left unrendered
 * here — out of scope for this pass, matching that neither view renders an actual bullet/number
 * glyph today.
 */
function extractBlockHtml(block: unknown): string {
  if (typeof block !== "object" || block === null) return "";
  const kind = (block as { kind?: unknown }).kind;
  if (kind === "codeBlock") {
    const text = (block as { text?: unknown }).text;
    const code = typeof text === "string" ? escapeHtml(text) : "";
    return `<pre style="margin:2px 0;padding:4px 6px;border:1px solid ${BORDER_COLOR};font-family:monospace;white-space:pre-wrap"><code>${code}</code></pre>`;
  }
  if (kind === "table") {
    const rows = (block as { rows?: unknown }).rows;
    if (!Array.isArray(rows)) return "";
    const rowsHtml = rows.map((row, index) => extractTableRowHtml(row, index === 0)).join("");
    return `<table style="border-collapse:collapse;margin:2px 0"><tbody>${rowsHtml}</tbody></table>`;
  }
  if (!("runs" in block)) return "";
  const runs = (block as { runs: unknown }).runs;
  const runsHtml = Array.isArray(runs) ? runs.map(extractRunHtml).join("") : "";

  const headingLevel = (block as { headingLevel?: unknown }).headingLevel;
  const blockquoteDepth = (block as { blockquoteDepth?: unknown }).blockquoteDepth;
  const styles = ["margin:0 0 4px 0"];
  if (typeof headingLevel === "number" && headingLevel > 0) {
    // Mirrors index.css's p[data-heading-level] rules (1.8em/1.5em/1.3em/1.1em, all weight 600).
    const size =
      headingLevel === 1 ? "1.8em" : headingLevel === 2 ? "1.5em" : headingLevel === 3 ? "1.3em" : "1.1em";
    styles.push(`font-size:${size}`, "font-weight:600");
  }
  if (typeof blockquoteDepth === "number" && blockquoteDepth > 0) {
    styles.push(`border-left:3px solid ${BORDER_COLOR}`, `padding-left:${blockquoteDepth * 8}px`);
  }
  return `<p style="${styles.join(";")}">${runsHtml}</p>`;
}

function extractContentHtmlInner(content: unknown): string {
  if (typeof content === "string") return escapeHtml(content);
  if (typeof content !== "object" || content === null) return "";
  if ("paragraphs" in content) {
    const paragraphs = (content as { paragraphs: unknown }).paragraphs;
    if (Array.isArray(paragraphs)) {
      return paragraphs.map(extractBlockHtml).join("");
    }
  }
  if ("text" in content) {
    const text = (content as { text: unknown }).text;
    if (typeof text === "string") return escapeHtml(text);
  }
  return "";
}

/**
 * A genuinely empty string (a freshly-created, not-yet-typed-into text box's actual starting
 * content) is never handed to `HTMLText.text` as-is — a zero-width-space placeholder goes in
 * instead. Observed live: an `HTMLText` node's very first transition from a truly empty `text`
 * to real content threw a `_style` null-deref deep inside PixiJS's own `HTMLTextPipe` (a stale
 * async raster job's completion callback running against state a newer one had already reset) —
 * this sidesteps that specific empty→populated transition entirely, since the box then always
 * already holds *some* (invisible) rendered content by the time real text arrives.
 */
function extractContentHtml(content: unknown): string {
  const html = extractContentHtmlInner(content);
  return html.length > 0 ? html : "&#8203;";
}

/**
 * `backgroundColor`/`backgroundOpacity`/`defaultTextColor` are the backward-compat boundary for
 * these three fields: every text box saved before they existed has none of these keys at all, so
 * this is where missing/invalid values get defaulted (mirroring how `ParagraphAttrs`' new attrs
 * default via ProseMirror's own "absent key" handling on the text-editor side) — every other
 * consumer in this codebase can then treat `TextBoxData` as always fully populated.
 */
function validateTextBoxData(data: unknown): TextBoxData {
  if (typeof data !== "object" || data === null || !("content" in data)) {
    throw new Error("text-box data must be an object with a `content` field.");
  }
  const raw = data as {
    content: unknown;
    backgroundColor?: unknown;
    backgroundOpacity?: unknown;
    defaultTextColor?: unknown;
  };
  return {
    content: raw.content,
    backgroundColor: typeof raw.backgroundColor === "string" ? raw.backgroundColor : null,
    backgroundOpacity: typeof raw.backgroundOpacity === "number" ? raw.backgroundOpacity : 1,
    defaultTextColor: typeof raw.defaultTextColor === "string" ? raw.defaultTextColor : null,
  };
}

interface TextBoxView extends Container {
  border: Graphics;
  preview: HTMLText;
  /** Tracks the last color applied to `preview.style.fill`, since `HTMLTextStyle.fill`'s own
   *  public getter is unreliable in this pixi.js version (always reads back `undefined`
   *  regardless of what was set) — reading it back to decide whether reassignment is needed
   *  isn't an option, so this is tracked explicitly instead. See `drawTextBoxView`'s guard
   *  comment for why avoiding a redundant `HTMLText` style/text reassignment matters here in a
   *  way it never did for the old plain `Text` node. */
  lastFillColor: string;
}

function isTextBoxView(view: Container): view is TextBoxView {
  return "border" in view && "preview" in view;
}

export const textBoxObjectType: ObjectTypeDefinition<"text-box", TextBoxData> = {
  type: "text-box",

  validate: validateTextBoxData,

  createView(object, origin): Container {
    const container = new Container() as TextBoxView;
    const border = new Graphics();
    const initialFill = object.data.defaultTextColor ?? DEFAULT_TEXT_COLOR;
    const preview = new HTMLText({
      text: extractContentHtml(object.data.content),
      style: {
        fontFamily: "sans-serif",
        fontSize: 14,
        fill: initialFill,
        wordWrap: true,
      },
    });
    container.addChild(border);
    container.addChild(preview);
    container.border = border;
    container.preview = preview;
    container.lastFillColor = initialFill;
    drawTextBoxView(container, object, origin);
    return container;
  },

  updateView(view, object, origin): void {
    if (isTextBoxView(view)) {
      drawTextBoxView(view, object, origin);
    }
  },

  hitTest(object, point): boolean {
    const { x, y, width, height } = object.bounds;
    return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
  },

  supportsRotation: true,
  supportsResize: true,
};

/**
 * Geometry is baked in chunk-local space: `object.bounds` (world space) minus `origin` (the
 * containing chunk's world-space offset — see PixiRenderer's chunk-container doc comment), so
 * `PixiRenderer` only applies `transform.x/y/rotation/scale` on top of whatever this function
 * draws — it does not know about `bounds` at all.
 */
function drawTextBoxView(view: TextBoxView, object: TextBoxObject, origin: ChunkOrigin): void {
  const x = object.bounds.x - origin.x;
  const y = object.bounds.y - origin.y;
  const { width, height } = object.bounds;
  const data = object.data;

  view.border.clear();
  view.border.rect(x, y, width, height);
  // Fill (if any) before the stroke, matching shape-object-type.ts's own fill-then-stroke order
  // — `backgroundColor: null` (the default) means no fill at all, leaving the box transparent.
  if (data.backgroundColor) {
    view.border.fill({ color: data.backgroundColor, alpha: data.backgroundOpacity });
  }
  view.border.stroke({ width: 1, color: BORDER_COLOR });

  // Guarded, and a full destroy-and-recreate rather than an in-place `.text`/`.style.fill`
  // mutation, when content or color actually changed — the cold view stays mounted and synced
  // (via repeated `syncObject` calls) even *while* a text box is being edited (see
  // text-edit-events.ts's own doc comment on why the placeholder underneath isn't hidden), and
  // `PageEditorView`'s autosize `ResizeObserver` calls `scene.update` on every single keystroke
  // purely to keep `bounds` current, which reaches this function every time too even though
  // `data.content` itself hasn't changed — the guard skips all of that redundant traffic outright.
  // Unlike the old plain `Text` node, `HTMLText` rasterizes its content asynchronously (SVG →
  // texture); reassigning `.text`/`.style.fill` *in place* on an existing instance — even when
  // this guard only lets the value-changing case through — was observed live to leave orphaned
  // batch geometry on screen (a persistent stray outlined rectangle with no content) and throw
  // `HTMLTextPipe`-internal null-derefs on a delayed, unrelated later interaction (a stale async
  // raster job's completion running against state a newer one had already reset). Destroying the
  // old node and constructing a fresh one only on an actual change avoids ever mutating a live
  // `HTMLText` instance's text/fill after its first paint, which is what those failures traced
  // back to.
  const html = extractContentHtml(data.content);
  const fillColor = data.defaultTextColor ?? DEFAULT_TEXT_COLOR;
  if (view.preview.text !== html || view.lastFillColor !== fillColor) {
    const index = view.getChildIndex(view.preview);
    view.preview.destroy();
    const nextPreview = new HTMLText({
      text: html,
      style: { fontFamily: "sans-serif", fontSize: 14, fill: fillColor, wordWrap: true },
    });
    view.addChildAt(nextPreview, index);
    view.preview = nextPreview;
    view.lastFillColor = fillColor;
  }
  view.preview.position.set(x + 4, y + 4);
  const wordWrapWidth = Math.max(0, width - 8);
  if (view.preview.style.wordWrapWidth !== wordWrapWidth) {
    view.preview.style.wordWrapWidth = wordWrapWidth;
  }
}
