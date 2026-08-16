import { describe, expect, it } from "vitest";
import { proseMirrorDocToRichTextDocument, richTextDocumentToProseMirrorDoc } from "./document-conversion.js";
import {
  emptyRichTextDocument,
  type RichTextBlock,
  type RichTextDocument,
  type RichTextParagraphBlock,
} from "./marks.js";

/** Every test here only ever produces `"paragraph"`-kind blocks — `"codeBlock"`/`"table"` blocks
 *  aren't convertible yet (see document-conversion.ts's own doc comment) — so narrowing through
 *  this helper keeps the assertions below free of per-call union-narrowing noise. */
function asParagraph(block: RichTextBlock | undefined): RichTextParagraphBlock {
  if (!block || (block.kind !== undefined && block.kind !== "paragraph")) {
    throw new Error("Expected a paragraph block");
  }
  return block;
}

/** A document exercising every mark kind, both list kinds, a non-zero indent, a non-null tagId,
 *  a heading level, and a blockquote depth. */
function fixtureDocument(): RichTextDocument {
  return {
    paragraphs: [
      {
        runs: [
          { text: "Plain ", marks: [] },
          { text: "bold", marks: [{ kind: "bold" }] },
          { text: "italic", marks: [{ kind: "italic" }] },
        ],
        listKind: "none",
        indentLevel: 0,
        tagId: null,
        headingLevel: 2,
        blockquoteDepth: 0,
      },
      {
        runs: [
          { text: "underline", marks: [{ kind: "underline" }] },
          { text: "strike", marks: [{ kind: "strikethrough" }] },
        ],
        listKind: "bulleted",
        indentLevel: 1,
        tagId: "to-do",
        headingLevel: 0,
        blockquoteDepth: 1,
      },
      {
        runs: [
          { text: "highlighted", marks: [{ kind: "highlight", attr: "#ffff00" }] },
          { text: "linked", marks: [{ kind: "link", attr: "https://example.com" }] },
          { text: "My Page", marks: [{ kind: "wikilink", attr: "page-42", attr2: "My Page" }] },
          { text: "colored", marks: [{ kind: "textColor", attr: "#ff00ff" }] },
        ],
        listKind: "numbered",
        indentLevel: 2,
        tagId: "important",
        headingLevel: 0,
        blockquoteDepth: 0,
      },
      {
        runs: [],
        listKind: "none",
        indentLevel: 0,
        tagId: null,
        headingLevel: 0,
        blockquoteDepth: 0,
      },
    ],
  };
}

describe("richTextDocumentToProseMirrorDoc / proseMirrorDocToRichTextDocument", () => {
  it("round-trips text, every mark kind (with attrs), list kind, indent level, tagId, heading level, and blockquote depth", () => {
    const original = fixtureDocument();
    const pmDoc = richTextDocumentToProseMirrorDoc(original);
    const roundTripped = proseMirrorDocToRichTextDocument(pmDoc);

    expect(roundTripped.paragraphs).toHaveLength(original.paragraphs.length);

    const [para0, para1, para2, para3] = roundTripped.paragraphs.map(asParagraph);

    expect(para0?.listKind).toBe("none");
    expect(para0?.indentLevel).toBe(0);
    expect(para0?.tagId).toBeNull();
    expect(para0?.headingLevel).toBe(2);
    expect(para0?.blockquoteDepth).toBe(0);
    expect(para0?.runs.map((run) => ("text" in run ? run.text : "")).join("")).toBe("Plain bolditalic");
    expect(para0?.runs.some((run) => "marks" in run && run.marks.some((mark) => mark.kind === "bold"))).toBe(
      true,
    );
    expect(
      para0?.runs.some((run) => "marks" in run && run.marks.some((mark) => mark.kind === "italic")),
    ).toBe(true);

    expect(para1?.listKind).toBe("bulleted");
    expect(para1?.indentLevel).toBe(1);
    expect(para1?.tagId).toBe("to-do");
    expect(para1?.headingLevel).toBe(0);
    expect(para1?.blockquoteDepth).toBe(1);
    expect(
      para1?.runs.some((run) => "marks" in run && run.marks.some((mark) => mark.kind === "underline")),
    ).toBe(true);
    expect(
      para1?.runs.some((run) => "marks" in run && run.marks.some((mark) => mark.kind === "strikethrough")),
    ).toBe(true);

    expect(para2?.listKind).toBe("numbered");
    expect(para2?.indentLevel).toBe(2);
    expect(para2?.tagId).toBe("important");
    const marksOfPara2 = para2?.runs.flatMap((run) => ("marks" in run ? run.marks : [])) ?? [];
    const highlightMark = marksOfPara2.find((mark) => mark.kind === "highlight");
    expect(highlightMark?.attr).toBe("#ffff00");
    const linkMark = marksOfPara2.find((mark) => mark.kind === "link");
    expect(linkMark?.attr).toBe("https://example.com");
    const wikilinkMark = marksOfPara2.find((mark) => mark.kind === "wikilink");
    expect(wikilinkMark?.attr).toBe("page-42");
    expect(wikilinkMark?.attr2).toBe("My Page");
    const textColorMark = marksOfPara2.find((mark) => mark.kind === "textColor");
    expect(textColorMark?.attr).toBe("#ff00ff");

    // Empty paragraph: no text content, matches emptyRichTextDocument's shape (runs: []).
    expect(para3?.runs).toEqual([]);
    expect(para3?.listKind).toBe("none");
    expect(para3?.tagId).toBeNull();
  });

  it("round-trips a freshly created empty document", () => {
    const roundTripped = proseMirrorDocToRichTextDocument(
      richTextDocumentToProseMirrorDoc(emptyRichTextDocument()),
    );
    expect(roundTripped).toEqual(emptyRichTextDocument());
  });

  it("drops zero-length runs on the way in rather than throwing", () => {
    const document: RichTextDocument = {
      paragraphs: [
        {
          runs: [{ text: "", marks: [] }],
          listKind: "none",
          indentLevel: 0,
          tagId: null,
          headingLevel: 0,
          blockquoteDepth: 0,
        },
      ],
    };
    expect(() => richTextDocumentToProseMirrorDoc(document)).not.toThrow();
    const roundTripped = proseMirrorDocToRichTextDocument(richTextDocumentToProseMirrorDoc(document));
    expect(asParagraph(roundTripped.paragraphs[0]).runs).toEqual([]);
  });

  it("falls back to an empty document when given zero paragraphs, since the schema requires paragraph+", () => {
    const roundTripped = proseMirrorDocToRichTextDocument(
      richTextDocumentToProseMirrorDoc({ paragraphs: [] }),
    );
    expect(roundTripped).toEqual(emptyRichTextDocument());
  });

  it("treats an old on-disk paragraph with no kind field (backward compatibility) the same as an explicit paragraph", () => {
    // Simulates pre-existing persisted content, which never had headingLevel/blockquoteDepth/kind
    // keys at all — ProseMirror's own attr defaulting (not any migration code here) is what
    // makes this work; see marks.ts's RichTextParagraphBlock doc comment.
    const legacyDocument = {
      paragraphs: [{ runs: [{ text: "legacy", marks: [] }], listKind: "none", indentLevel: 0, tagId: null }],
    } as unknown as RichTextDocument;

    const roundTripped = proseMirrorDocToRichTextDocument(richTextDocumentToProseMirrorDoc(legacyDocument));
    const paragraph = asParagraph(roundTripped.paragraphs[0]);
    expect(paragraph.headingLevel).toBe(0);
    expect(paragraph.blockquoteDepth).toBe(0);
    expect(paragraph.runs.map((run) => ("text" in run ? run.text : "")).join("")).toBe("legacy");
  });
});
