import { Schema } from "prosemirror-model";
import type { ListKind } from "./marks.js";

/**
 * ProseMirror schema for the rich-text field. Deliberately flat: every
 * paragraph is a direct child of `doc` and carries `listKind`/`indentLevel`/
 * `tagId`/`headingLevel`/`blockquoteDepth` as node attributes rather than
 * nesting under list/blockquote/heading nodes (as `prosemirror-schema-list`
 * or a standard heading node type would). `RichTextParagraphBlock` in the
 * domain schema (`./marks.ts`) is itself flat with those same fields per
 * paragraph, so a flat node model maps onto it 1:1 with no reconstruction of
 * indent/list/heading/quote state from ancestor nesting — headings and
 * blockquotes are structural indicators (like `listKind` already was), not
 * content with their own nesting/isolation requirements, so they don't need
 * a real node type the way `code_block`/`table` do. See
 * `document-conversion.ts` for the conversion to/from `RichTextDocument`.
 */

export type RichTextSchemaNodeName =
  "doc" | "paragraph" | "code_block" | "table" | "table_row" | "table_cell" | "image" | "text";
export type RichTextSchemaMarkName =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "highlight"
  | "link"
  | "wikilink"
  | "code"
  | "textColor";

/** Node attributes carried by every `code_block` node. */
export interface CodeBlockAttrs {
  /** The fence's info string (e.g. "ts" in ` ```ts `) — captured for round-trip fidelity;
   *  nothing renders syntax highlighting from it yet. */
  language: string | null;
}

/** Node attributes carried by every `table` node. Mirrors `RichTextTableBlock.headerRowCount`. */
export interface TableAttrs {
  /** Always `1` in v1 (see `RichTextTableBlock`'s doc comment) — kept as a real attr rather than
   *  an assumed constant so a future multi-header-row extension is a value change, not a shape
   *  change. */
  headerRowCount: number;
}

/** Node attributes carried by every `paragraph` node. Mirrors the non-`runs` fields of `RichTextParagraphBlock`. */
export interface ParagraphAttrs {
  listKind: ListKind;
  indentLevel: number;
  /** OneNote-style tag id attached to the whole paragraph; carried as a plain node attribute for round-trip fidelity. */
  tagId: string | null;
  /** 0 = not a heading; 1-6 = ATX heading level (`#` through `######`). */
  headingLevel: number;
  /** 0 = not inside a blockquote; N = nested N levels of `>`. */
  blockquoteDepth: number;
}

/** Attributes for the `highlight` mark. */
export interface HighlightAttrs {
  color: string | null;
}

/** Attributes for the `textColor` mark — a free-standing foreground-color override, applied via
 *  the floating toolbar shown while editing (see `ProseMirrorRichTextField.setTextColor`), not
 *  typed markdown. Independent of the OneNote-style paragraph `tagId` and of `TextBoxData
 *  .defaultTextColor` (the per-textbox base color this mark overrides when present). */
export interface TextColorAttrs {
  color: string | null;
}

/** Attributes for the `link` mark. */
export interface LinkAttrs {
  href: string;
}

/**
 * Attributes for the `wikilink` mark — a `[[Page Title]]` reference resolved (or pending
 * auto-creation) to a target page id, distinct from a plain `link` mark's raw `href`.
 */
export interface WikilinkAttrs {
  pageId: string;
  displayText: string;
  /** In-page anchor (a heading paragraph's text) within the target page, or `null` for a link
   *  to the page as a whole — see `marks.ts`'s `TextMark.attr3` doc comment. */
  anchor: string | null;
}

/** Node attributes carried by every `image` node. Mirrors `RichTextImageRun`'s fields — see its
 *  doc comment in `marks.ts` for why only `http(s)://` sources are typeable via markdown. */
export interface ImageAttrs {
  src: string;
  alt: string;
}

export const richTextSchema = new Schema<RichTextSchemaNodeName, RichTextSchemaMarkName>({
  nodes: {
    doc: { content: "(paragraph | code_block | table)+" },
    paragraph: {
      content: "(text | image)*",
      group: "block",
      attrs: {
        listKind: { default: "none" },
        indentLevel: { default: 0 },
        tagId: { default: null },
        headingLevel: { default: 0 },
        blockquoteDepth: { default: 0 },
      },
      parseDOM: [
        {
          tag: "p",
          getAttrs(dom) {
            const element = dom as HTMLElement;
            const indentAttr = element.getAttribute("data-indent-level");
            const headingAttr = element.getAttribute("data-heading-level");
            const blockquoteAttr = element.getAttribute("data-blockquote-depth");
            return {
              listKind: (element.getAttribute("data-list-kind") as ListKind | null) ?? "none",
              indentLevel: indentAttr ? Number.parseInt(indentAttr, 10) : 0,
              tagId: element.getAttribute("data-tag-id"),
              headingLevel: headingAttr ? Number.parseInt(headingAttr, 10) : 0,
              blockquoteDepth: blockquoteAttr ? Number.parseInt(blockquoteAttr, 10) : 0,
            };
          },
        },
      ],
      toDOM(node) {
        const attrs = node.attrs as ParagraphAttrs;
        const domAttrs: Record<string, string> = {
          "data-list-kind": attrs.listKind,
          "data-indent-level": String(attrs.indentLevel),
          "data-heading-level": String(attrs.headingLevel),
          "data-blockquote-depth": String(attrs.blockquoteDepth),
        };
        if (attrs.tagId !== null) {
          domAttrs["data-tag-id"] = attrs.tagId;
        }
        return ["p", domAttrs, 0];
      },
    },
    text: { group: "inline" },
    // `marks: ""` (not omitted, which would mean "any mark") is load-bearing: it's what stops
    // bold/italic/etc. input rules from having any mark to apply even if their regex somehow
    // matched inside a code block — see `markdown-input-rules.ts`'s `plainParagraphContext`
    // guard, which independently also stops those rules from firing here at all. `code: true`
    // is prosemirror-commands' own signal (used by `newlineInCode`/`exitCode`) that this is a
    // code container, matching the standard convention from prosemirror-example-setup's schema.
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      marks: "",
      attrs: { language: { default: null } },
      parseDOM: [
        {
          tag: "pre",
          preserveWhitespace: "full",
          getAttrs(dom) {
            return { language: (dom as HTMLElement).getAttribute("data-language") };
          },
        },
      ],
      toDOM(node) {
        const attrs = node.attrs as CodeBlockAttrs;
        return ["pre", { "data-language": attrs.language ?? "" }, ["code", 0]];
      },
    },
    // No `prosemirror-tables` dependency — that package brings CellSelection/resize/merge
    // machinery this simple GFM-grid v1 doesn't need (see the project plan's Task D section for
    // the full reasoning). `isolating: true` on `table`/`table_cell` keeps selection/deletion
    // gestures from leaking across cell boundaries the way plain paragraphs would allow, matching
    // `prosemirror-schema-list`'s own use of `isolating` for list items. A single `table_cell`
    // type (no separate header-cell node) is deliberate: header-row styling is pure CSS
    // (`tr:first-child`, driven by `TableAttrs.headerRowCount`), not a schema-level distinction.
    table: {
      content: "table_row+",
      group: "block",
      isolating: true,
      attrs: { headerRowCount: { default: 1 } },
      parseDOM: [
        {
          tag: "table",
          getAttrs(dom) {
            const attr = (dom as HTMLElement).getAttribute("data-header-row-count");
            return { headerRowCount: attr ? Number.parseInt(attr, 10) : 1 };
          },
        },
      ],
      toDOM(node) {
        const attrs = node.attrs as TableAttrs;
        return ["table", { "data-header-row-count": String(attrs.headerRowCount) }, ["tbody", 0]];
      },
    },
    table_row: {
      content: "table_cell+",
      parseDOM: [{ tag: "tr" }],
      toDOM: () => ["tr", 0],
    },
    table_cell: {
      content: "paragraph",
      isolating: true,
      parseDOM: [{ tag: "td" }, { tag: "th" }],
      toDOM: () => ["td", 0],
    },
    // `atom: true` marks this as a single indivisible unit for cursor/selection purposes (the
    // standard `prosemirror-schema-basic` treatment for images) — there's no "inside" an image
    // node the way there is for a text run, so ProseMirror shouldn't try to place a cursor within
    // one. `inline: true` + the `"inline"` group lets it sit directly among text runs in a
    // paragraph, matching `paragraph`'s `"(text | image)*"` content expression above.
    image: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: { src: { default: "" }, alt: { default: "" } },
      parseDOM: [
        {
          tag: "img[src]",
          getAttrs(dom) {
            const element = dom as HTMLElement;
            return { src: element.getAttribute("src") ?? "", alt: element.getAttribute("alt") ?? "" };
          },
        },
      ],
      toDOM(node) {
        const attrs = node.attrs as ImageAttrs;
        return ["img", attrs];
      },
    },
  },
  marks: {
    bold: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: () => ["strong", 0],
    },
    italic: {
      parseDOM: [{ tag: "em" }, { tag: "i" }],
      toDOM: () => ["em", 0],
    },
    underline: {
      parseDOM: [{ tag: "u" }],
      toDOM: () => ["u", 0],
    },
    strikethrough: {
      parseDOM: [{ tag: "s" }],
      toDOM: () => ["s", 0],
    },
    code: {
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", 0],
    },
    highlight: {
      attrs: { color: { default: null } },
      parseDOM: [
        {
          tag: "mark",
          getAttrs(dom) {
            return { color: (dom as HTMLElement).getAttribute("data-color") };
          },
        },
      ],
      toDOM(mark) {
        const attrs = mark.attrs as HighlightAttrs;
        const domAttrs: Record<string, string> = {};
        if (attrs.color !== null) {
          domAttrs["data-color"] = attrs.color;
          domAttrs.style = `background-color: ${attrs.color}`;
        }
        return ["mark", domAttrs, 0];
      },
    },
    // Exact same `{color}`-attr shape as `highlight` above, just foreground instead of
    // background — `data-text-color` (not `data-color`, `highlight`'s own attribute name) keeps
    // the two distinguishable in the DOM/by any code parsing serialized content, mirroring
    // `wikilink`'s `data-wikilink` vs. plain `link`'s bare `<a href>` for the same reason.
    textColor: {
      attrs: { color: { default: null } },
      parseDOM: [
        {
          tag: "span[data-text-color]",
          getAttrs(dom) {
            return { color: (dom as HTMLElement).getAttribute("data-color") };
          },
        },
      ],
      toDOM(mark) {
        const attrs = mark.attrs as TextColorAttrs;
        const domAttrs: Record<string, string> = { "data-text-color": "" };
        if (attrs.color !== null) {
          domAttrs["data-color"] = attrs.color;
          domAttrs.style = `color: ${attrs.color}`;
        }
        return ["span", domAttrs, 0];
      },
    },
    link: {
      attrs: { href: { default: "" } },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs(dom) {
            return { href: (dom as HTMLElement).getAttribute("href") ?? "" };
          },
        },
      ],
      toDOM(mark) {
        const attrs = mark.attrs as LinkAttrs;
        return ["a", { href: attrs.href }, 0];
      },
    },
    // Mirrors `link` above, but carries two attrs (a resolved page id plus the display text
    // typed between `[[`/`]]`) and is marked with `data-wikilink`/`data-page-id` rather than a
    // plain `href`, so it's structurally distinguishable from an ordinary `link` mark both in
    // the DOM and by any code parsing serialized content (see `marks.ts`'s `TextMark.attr2` doc
    // comment for why the domain-model side carries two attrs the same way).
    wikilink: {
      attrs: { pageId: { default: "" }, displayText: { default: "" }, anchor: { default: null } },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[data-wikilink]",
          getAttrs(dom) {
            const element = dom as HTMLElement;
            return {
              pageId: element.getAttribute("data-page-id") ?? "",
              displayText: element.textContent ?? "",
              anchor: element.getAttribute("data-anchor"),
            };
          },
        },
      ],
      toDOM(mark) {
        const attrs = mark.attrs as WikilinkAttrs;
        const domAttrs: Record<string, string> = {
          "data-wikilink": "",
          "data-page-id": attrs.pageId,
        };
        if (attrs.anchor !== null) {
          domAttrs["data-anchor"] = attrs.anchor;
        }
        return ["a", domAttrs, 0];
      },
    },
  },
});
