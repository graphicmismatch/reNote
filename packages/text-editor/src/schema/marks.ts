/** Character-level formatting, independent of which DOM editor library implements it. */
export type TextMarkKind =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "highlight"
  | "link"
  | "wikilink"
  | "code"
  | "textColor";

export interface TextMark {
  kind: TextMarkKind;
  /**
   * Highlight color for "highlight" marks, href for "link" marks, resolved target `pageId` for
   * "wikilink" marks, foreground text color for "textColor" marks; unused otherwise. "textColor"
   * is a free-standing formatting mark applied via the floating toolbar shown while editing a
   * text box — independent of the OneNote-style paragraph tag system (`RichTextParagraphBlock
   * .tagId` below), which has its own separate color story.
   */
  attr?: string;
  /**
   * Second attribute slot, used only by "wikilink" marks to carry the display text the user
   * actually typed between `[[` and the point of resolution (e.g. "My Page" for `[[My Page]]`)
   * — kept separate from `attr` (the resolved `pageId`) rather than overloading a single string
   * field, since a wikilink is the one mark kind that needs two independent pieces of data at
   * once. Every other mark kind leaves this undefined. This is a deliberately minimal addition
   * (a second optional field) rather than a discriminated union of per-kind mark shapes, so the
   * existing `attr?: string` contract for the other five kinds — and every call site that reads
   * it — stays untouched. The JSON shape this produces (`{"kind":"wikilink","attr":"<pageId>",
   * "attr2":"<displayText>"}`) is also exactly what `renote-index`'s Rust-side
   * `extract_wikilink_targets` walk reads back out — the two sides must agree on these field
   * names since this struct crosses the Tauri JSON boundary as opaque `data`.
   */
  attr2?: string;
  /**
   * Third attribute slot, used only by "wikilink" marks to carry an in-page anchor — the text of
   * the heading paragraph the link points AT within its target page, for a link that goes to a
   * specific spot rather than the top of the page (`[[#Setup]]`). Absent on every link that
   * targets a whole page, and on every other mark kind.
   *
   * Deliberately a third field rather than an anchor appended onto `attr` (e.g.
   * `"<pageId>#Setup"`): `attr` is exactly what `renote-index`'s Rust-side
   * `extract_wikilink_targets` walk reads as the `page_link` row's target page id, so anything
   * but a bare page id there would corrupt backlinks and the graph view. Extra fields are opaque
   * to that walk (page `data` crosses the Tauri boundary as untyped JSON), so this one costs the
   * Rust side nothing.
   */
  attr3?: string;
}

export type ListKind = "none" | "bulleted" | "numbered";

/**
 * `kind` is optional and defaults to `"text"` — every run persisted before the `image` run kind
 * existed has no `kind` field at all, and ProseMirror's own `Node.create` already treats a
 * missing attr key as "use the schema default," so old on-disk documents load correctly with no
 * migration step; the `?? "text"` check at the one place that dispatches on it is the whole
 * compatibility story.
 */
export interface RichTextTextRun {
  kind?: "text";
  text: string;
  marks: TextMark[];
}

/** An inline image reference — `http(s)://` URLs only, see `markdown-input-rules.ts`'s
 *  `imageInputRule` doc comment for why local file paths are out of scope for typed markdown. */
export interface RichTextImageRun {
  kind: "image";
  src: string;
  alt: string;
}

export type RichTextRun = RichTextTextRun | RichTextImageRun;

/**
 * `kind` is optional and defaults to `"paragraph"` for the exact same reason as `RichTextTextRun`
 * above — every paragraph persisted before `codeBlock`/`table` existed has no `kind` field.
 */
export interface RichTextParagraphBlock {
  kind?: "paragraph";
  runs: RichTextRun[];
  listKind: ListKind;
  indentLevel: number;
  /** OneNote-style tag (To Do, Important, Question, ...) attached to this paragraph, if any. */
  tagId: string | null;
  /** 0 = not a heading; 1-6 = ATX heading level (`#` through `######`). */
  headingLevel: number;
  /** 0 = not inside a blockquote; N = nested N levels of `>`. */
  blockquoteDepth: number;
}

/** A fenced code block: raw, unformatted multi-line text with no inline marks — see
 *  `prosemirror-schema.ts`'s `code_block` node (`marks: ""`) for why marks can't apply inside
 *  one. `language` is the fence's info string (e.g. "ts" in ` ```ts `), captured for round-trip
 *  fidelity; nothing renders syntax highlighting from it yet. */
export interface RichTextCodeBlock {
  kind: "codeBlock";
  text: string;
  language: string | null;
}

/** One row of a `RichTextTableBlock` — cells are themselves paragraph blocks (single-paragraph
 *  content only in v1; see `prosemirror-schema.ts`'s `table_cell` node). */
export interface RichTextTableRow {
  cells: RichTextParagraphBlock[];
}

/** A simple GFM-style grid table: no merged cells, no column alignment (deferred — see the
 *  project plan), `headerRowCount` is always 1 in v1 but kept as a field rather than an assumed
 *  constant so a future multi-header-row extension doesn't need a shape change. Deliberately
 *  separate from `packages/core`'s sibling `TableData` canvas-object type — that's an
 *  independently-positioned, resizable object with its own creation tool; this is markdown-typed
 *  content flowing inside a text box, with no shared code path between the two. */
export interface RichTextTableBlock {
  kind: "table";
  rows: RichTextTableRow[];
  headerRowCount: number;
}

export type RichTextBlock = RichTextParagraphBlock | RichTextCodeBlock | RichTextTableBlock;

/** The document shape stored in a text-box PageObject's `data.content` and in table cells. The
 *  array is still named `paragraphs` even though its elements are now a `RichTextBlock` union
 *  (not always literally paragraphs) — renaming the JSON key would be a second, needless
 *  backward-compatibility surface on top of the `kind`-discriminant one already required, and
 *  every existing consumer (this package, `text-box-object-type.ts`'s cold preview) already keys
 *  off this exact name. */
export interface RichTextDocument {
  paragraphs: RichTextBlock[];
}

export function emptyRichTextDocument(): RichTextDocument {
  return {
    paragraphs: [
      { runs: [], listKind: "none", indentLevel: 0, tagId: null, headingLevel: 0, blockquoteDepth: 0 },
    ],
  };
}

function plainTextOfRun(run: RichTextRun): string {
  return run.kind === "image" ? (run.alt.length > 0 ? `[image: ${run.alt}]` : "[image]") : run.text;
}

function plainTextOfBlock(block: RichTextBlock): string {
  const kind = block.kind ?? "paragraph";
  if (kind === "codeBlock") return (block as RichTextCodeBlock).text;
  if (kind === "table") {
    return (block as RichTextTableBlock).rows
      .map((row) => row.cells.map(plainTextOfBlock).join(" | "))
      .join("\n");
  }
  return (block as RichTextParagraphBlock).runs.map(plainTextOfRun).join("");
}

export function plainTextOf(document: RichTextDocument): string {
  return document.paragraphs.map(plainTextOfBlock).join("\n");
}
