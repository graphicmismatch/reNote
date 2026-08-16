import { describe, expect, it } from "vitest";
import { emptyRichTextDocument, plainTextOf, type RichTextDocument } from "./marks.js";

describe("plainTextOf", () => {
  it("extracts plain text across runs and paragraphs, ignoring marks", () => {
    const document: RichTextDocument = {
      paragraphs: [
        {
          runs: [
            { text: "Hello ", marks: [] },
            { text: "world", marks: [{ kind: "bold" }] },
          ],
          listKind: "none",
          indentLevel: 0,
          tagId: null,
          headingLevel: 0,
          blockquoteDepth: 0,
        },
        {
          runs: [{ text: "Second line", marks: [] }],
          listKind: "bulleted",
          indentLevel: 1,
          tagId: "to-do",
          headingLevel: 0,
          blockquoteDepth: 0,
        },
      ],
    };

    expect(plainTextOf(document)).toBe("Hello world\nSecond line");
  });

  it("returns an empty string for a freshly created document", () => {
    expect(plainTextOf(emptyRichTextDocument())).toBe("");
  });

  it("treats a paragraph with no explicit kind the same as an old on-disk paragraph (backward compatibility)", () => {
    // Old persisted paragraphs never had a `kind` field at all — cast through `unknown` since
    // the TS type now requires `headingLevel`/`blockquoteDepth`, but runtime data predating
    // those fields is exactly what this test simulates.
    const document = {
      paragraphs: [
        { runs: [{ text: "legacy paragraph", marks: [] }], listKind: "none", indentLevel: 0, tagId: null },
      ],
    } as unknown as RichTextDocument;

    expect(plainTextOf(document)).toBe("legacy paragraph");
  });

  it("renders a code block's raw text", () => {
    const document: RichTextDocument = {
      paragraphs: [{ kind: "codeBlock", text: "const x = 1;", language: "ts" }],
    };
    expect(plainTextOf(document)).toBe("const x = 1;");
  });

  it("renders a table's cells as pipe-separated rows", () => {
    const cell = (text: string) => ({
      runs: [{ text, marks: [] }],
      listKind: "none" as const,
      indentLevel: 0,
      tagId: null,
      headingLevel: 0,
      blockquoteDepth: 0,
    });
    const document: RichTextDocument = {
      paragraphs: [
        {
          kind: "table",
          headerRowCount: 1,
          rows: [{ cells: [cell("a"), cell("b")] }, { cells: [cell("c"), cell("d")] }],
        },
      ],
    };
    expect(plainTextOf(document)).toBe("a | b\nc | d");
  });

  it("renders an image run's alt text as a bracketed placeholder", () => {
    const document: RichTextDocument = {
      paragraphs: [
        {
          runs: [{ kind: "image", src: "https://example.com/cat.png", alt: "a cat" }],
          listKind: "none",
          indentLevel: 0,
          tagId: null,
          headingLevel: 0,
          blockquoteDepth: 0,
        },
      ],
    };
    expect(plainTextOf(document)).toBe("[image: a cat]");
  });
});

describe("TextMark wikilink shape", () => {
  it("carries the resolved page id in attr and the typed display text in attr2", () => {
    const document: RichTextDocument = {
      paragraphs: [
        {
          runs: [
            {
              text: "My Page",
              marks: [{ kind: "wikilink", attr: "page-42", attr2: "My Page" }],
            },
          ],
          listKind: "none",
          indentLevel: 0,
          tagId: null,
          headingLevel: 0,
          blockquoteDepth: 0,
        },
      ],
    };

    const paragraph = document.paragraphs[0];
    const run = paragraph && "runs" in paragraph ? paragraph.runs[0] : undefined;
    const mark = run && "marks" in run ? run.marks[0] : undefined;
    expect(mark?.kind).toBe("wikilink");
    expect(mark?.attr).toBe("page-42");
    expect(mark?.attr2).toBe("My Page");
  });
});
