import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import {
  richTextSchema,
  type CodeBlockAttrs,
  type HighlightAttrs,
  type ImageAttrs,
  type LinkAttrs,
  type ParagraphAttrs,
  type RichTextSchemaMarkName,
  type TableAttrs,
  type TextColorAttrs,
  type WikilinkAttrs,
} from "./prosemirror-schema.js";
import {
  emptyRichTextDocument,
  type RichTextBlock,
  type RichTextCodeBlock,
  type RichTextDocument,
  type RichTextParagraphBlock,
  type RichTextRun,
  type RichTextTableBlock,
  type RichTextTableRow,
  type TextMark,
} from "./marks.js";

/**
 * Pure conversion functions between the DOM-library-agnostic `RichTextDocument`
 * (see `./marks.ts`) and this package's ProseMirror node model
 * (`./prosemirror-schema.ts`). Neither direction touches the DOM or an
 * `EditorView` — both operate purely on `prosemirror-model` data structures,
 * so they're unit-testable without jsdom.
 *
 * Some lossiness is expected and accepted on the round trip: ProseMirror
 * normalizes mark order to schema declaration order and merges adjacent text
 * nodes that carry an identical mark set. Text content, mark presence/attrs,
 * list/indent/heading/quote state, and `tagId` are preserved exactly.
 *
 * `toProseMirrorBlock`/`fromProseMirrorBlock` and `toProseMirrorInlineContent`
 * handle every `RichTextBlock`/`RichTextRun` kind the domain model defines —
 * `"paragraph"`/`"codeBlock"`/`"table"` blocks, and text/image runs.
 */

function toProseMirrorMark(mark: TextMark): Mark {
  const kind = mark.kind as RichTextSchemaMarkName;
  switch (kind) {
    case "highlight": {
      const attrs: HighlightAttrs = { color: mark.attr ?? null };
      return richTextSchema.marks.highlight.create(attrs);
    }
    case "textColor": {
      const attrs: TextColorAttrs = { color: mark.attr ?? null };
      return richTextSchema.marks.textColor.create(attrs);
    }
    case "link": {
      const attrs: LinkAttrs = { href: mark.attr ?? "" };
      return richTextSchema.marks.link.create(attrs);
    }
    case "wikilink": {
      const attrs: WikilinkAttrs = {
        pageId: mark.attr ?? "",
        displayText: mark.attr2 ?? "",
        anchor: mark.attr3 ?? null,
      };
      return richTextSchema.marks.wikilink.create(attrs);
    }
    case "bold":
      return richTextSchema.marks.bold.create();
    case "italic":
      return richTextSchema.marks.italic.create();
    case "underline":
      return richTextSchema.marks.underline.create();
    case "strikethrough":
      return richTextSchema.marks.strikethrough.create();
    case "code":
      return richTextSchema.marks.code.create();
  }
}

function fromProseMirrorMark(mark: Mark): TextMark {
  const kind = mark.type.name;
  if (kind === "highlight") {
    const attrs = mark.attrs as HighlightAttrs;
    return attrs.color !== null ? { kind: "highlight", attr: attrs.color } : { kind: "highlight" };
  }
  if (kind === "textColor") {
    const attrs = mark.attrs as TextColorAttrs;
    return attrs.color !== null ? { kind: "textColor", attr: attrs.color } : { kind: "textColor" };
  }
  if (kind === "link") {
    const attrs = mark.attrs as LinkAttrs;
    return { kind: "link", attr: attrs.href };
  }
  if (kind === "wikilink") {
    const attrs = mark.attrs as WikilinkAttrs;
    const wikilink: TextMark = { kind: "wikilink", attr: attrs.pageId, attr2: attrs.displayText };
    // Only stamped on when there IS an anchor, so a plain whole-page link's persisted JSON is
    // byte-identical to what it was before anchors existed.
    return attrs.anchor !== null ? { ...wikilink, attr3: attrs.anchor } : wikilink;
  }
  // "bold" | "italic" | "underline" | "strikethrough" | "code" carry no attrs.
  return { kind: kind as TextMark["kind"] };
}

function toProseMirrorInlineContent(run: RichTextRun): ProseMirrorNode {
  if (run.kind === "image") {
    const attrs: ImageAttrs = { src: run.src, alt: run.alt };
    return richTextSchema.nodes.image.create(attrs);
  }
  return richTextSchema.text(run.text, run.marks.map(toProseMirrorMark));
}

function toProseMirrorParagraph(paragraph: RichTextParagraphBlock): ProseMirrorNode {
  const attrs: ParagraphAttrs = {
    listKind: paragraph.listKind,
    indentLevel: paragraph.indentLevel,
    tagId: paragraph.tagId,
    headingLevel: paragraph.headingLevel,
    blockquoteDepth: paragraph.blockquoteDepth,
  };
  const textNodes = paragraph.runs
    .filter((run) => run.kind === "image" || run.text.length > 0)
    .map(toProseMirrorInlineContent);
  return richTextSchema.nodes.paragraph.create(attrs, textNodes);
}

function toProseMirrorCodeBlock(block: RichTextCodeBlock): ProseMirrorNode {
  const attrs: CodeBlockAttrs = { language: block.language };
  const textNode = block.text.length > 0 ? richTextSchema.text(block.text) : undefined;
  return richTextSchema.nodes.code_block.create(attrs, textNode);
}

function toProseMirrorTableRow(row: RichTextTableRow): ProseMirrorNode {
  const cells = row.cells.map((cell) =>
    richTextSchema.nodes.table_cell.create(null, toProseMirrorParagraph(cell)),
  );
  return richTextSchema.nodes.table_row.create(null, cells);
}

function toProseMirrorTableBlock(block: RichTextTableBlock): ProseMirrorNode {
  const attrs: TableAttrs = { headerRowCount: block.headerRowCount };
  return richTextSchema.nodes.table.create(attrs, block.rows.map(toProseMirrorTableRow));
}

function toProseMirrorBlock(block: RichTextBlock): ProseMirrorNode {
  const kind = block.kind ?? "paragraph";
  if (kind === "paragraph") return toProseMirrorParagraph(block as RichTextParagraphBlock);
  if (kind === "codeBlock") return toProseMirrorCodeBlock(block as RichTextCodeBlock);
  if (kind === "table") return toProseMirrorTableBlock(block as RichTextTableBlock);
  throw new Error(`"${kind}" blocks are not yet supported by richTextDocumentToProseMirrorDoc.`);
}

/** Converts a `RichTextDocument` into a ProseMirror `doc` node for this package's schema. */
export function richTextDocumentToProseMirrorDoc(document: RichTextDocument): ProseMirrorNode {
  const source = document.paragraphs.length > 0 ? document : emptyRichTextDocument();
  const blockNodes = source.paragraphs.map(toProseMirrorBlock);
  return richTextSchema.nodes.doc.create(null, blockNodes);
}

function fromProseMirrorParagraph(paragraphNode: ProseMirrorNode): RichTextParagraphBlock {
  const attrs = paragraphNode.attrs as ParagraphAttrs;
  const runs: RichTextRun[] = [];
  paragraphNode.forEach((child) => {
    if (child.isText) {
      runs.push({ text: child.text ?? "", marks: child.marks.map(fromProseMirrorMark) });
    } else if (child.type.name === "image") {
      const attrs = child.attrs as ImageAttrs;
      runs.push({ kind: "image", src: attrs.src, alt: attrs.alt });
    }
  });
  return {
    runs,
    listKind: attrs.listKind,
    indentLevel: attrs.indentLevel,
    tagId: attrs.tagId,
    headingLevel: attrs.headingLevel,
    blockquoteDepth: attrs.blockquoteDepth,
  };
}

function fromProseMirrorCodeBlock(node: ProseMirrorNode): RichTextCodeBlock {
  const attrs = node.attrs as CodeBlockAttrs;
  return { kind: "codeBlock", text: node.textContent, language: attrs.language };
}

function fromProseMirrorTableRow(rowNode: ProseMirrorNode): RichTextTableRow {
  const cells: RichTextParagraphBlock[] = [];
  rowNode.forEach((cellNode) => {
    // `table_cell`'s schema content is exactly one `paragraph` (see prosemirror-schema.ts) —
    // `cellNode.firstChild` is always that paragraph, never undefined for a well-formed doc.
    const paragraphNode = cellNode.firstChild;
    if (paragraphNode) cells.push(fromProseMirrorParagraph(paragraphNode));
  });
  return { cells };
}

function fromProseMirrorTableBlock(node: ProseMirrorNode): RichTextTableBlock {
  const attrs = node.attrs as TableAttrs;
  const rows: RichTextTableRow[] = [];
  node.forEach((rowNode) => rows.push(fromProseMirrorTableRow(rowNode)));
  return { kind: "table", rows, headerRowCount: attrs.headerRowCount };
}

function fromProseMirrorBlock(node: ProseMirrorNode): RichTextBlock {
  if (node.type.name === "paragraph") return fromProseMirrorParagraph(node);
  if (node.type.name === "code_block") return fromProseMirrorCodeBlock(node);
  if (node.type.name === "table") return fromProseMirrorTableBlock(node);
  throw new Error(`Cannot convert ProseMirror node type "${node.type.name}" back to a RichTextBlock yet.`);
}

/** Converts a ProseMirror `doc` node (of this package's schema) back into a `RichTextDocument`. */
export function proseMirrorDocToRichTextDocument(doc: ProseMirrorNode): RichTextDocument {
  const paragraphs: RichTextBlock[] = [];
  doc.forEach((blockNode) => {
    paragraphs.push(fromProseMirrorBlock(blockNode));
  });
  return { paragraphs };
}
