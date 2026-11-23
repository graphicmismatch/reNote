import { describe, expect, it } from "vitest";
import type { PageDocumentDto } from "@renote/storage-client";
import { pageMarkdown, pagePlainText, pagesMarkdown, printableHtml } from "./page-export.js";

const p = (runs: unknown[], extra: object = {}) => ({
  runs,
  listKind: "none",
  indentLevel: 0,
  tagId: null,
  ...extra,
});
const page = (title: string, paragraphs: unknown[] = []): PageDocumentDto => ({
  id: "page-1",
  sectionId: "s",
  parentPageId: null,
  orderKey: "a",
  title,
  background: { color: null, ruleLines: "none" },
  templateId: null,
  createdAt: "",
  modifiedAt: "",
  schemaVersion: 1,
  objects: [
    {
      id: "o",
      type: "text-box",
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0 },
      bounds: { x: 0, y: 0, width: 100, height: 40 },
      data: { content: { paragraphs } },
    },
  ],
});

describe("page-export (ported from renote-export's Rust tests)", () => {
  it("renders headings, lists, marks, links, quotes, code, tables and escapes", () => {
    expect(pageMarkdown(page("My Page", [p([{ text: "hello", marks: [] }])]))).toBe("# My Page\n\nhello");
    expect(pageMarkdown(page("T", [p([{ text: "S", marks: [] }], { headingLevel: 2 })]))).toBe("# T\n\n## S");
    expect(
      pageMarkdown(page("T", [p([{ text: "i", marks: [] }], { listKind: "bulleted", indentLevel: 1 })])),
    ).toBe("# T\n\n  - i");
    expect(
      pageMarkdown(
        page("T", [
          p([
            { text: "both", marks: [{ kind: "bold" }, { kind: "italic" }] },
            { text: "code", marks: [{ kind: "code" }] },
            { text: "site", marks: [{ kind: "link", attr: "https://x.y" }] },
            { text: "x", marks: [{ kind: "wikilink", attr: "p2", attr2: "Other" }] },
          ]),
        ]),
      ),
    ).toBe("# T\n\n***both***`code`[site](https://x.y)[[Other]]");
    expect(pageMarkdown(page("T", [p([{ text: "q", marks: [] }], { blockquoteDepth: 2 })]))).toBe(
      "# T\n\n> > q",
    );
    expect(pageMarkdown(page("T", [{ kind: "codeBlock", text: "let x;", language: "ts" }]))).toBe(
      "# T\n\n```ts\nlet x;\n```",
    );
    const cell = (text: string) => p([{ text, marks: [] }]);
    expect(
      pageMarkdown(
        page("T", [
          {
            kind: "table",
            headerRowCount: 1,
            rows: [{ cells: [cell("A"), cell("B")] }, { cells: [cell("1"), cell("2")] }],
          },
        ]),
      ),
    ).toBe("# T\n\n| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(pageMarkdown(page("T", [p([{ text: "a*b_c`d[e]f", marks: [] }])]))).toBe(
      "# T\n\na\\*b\\_c\\`d\\[e\\]f",
    );
    expect(pagesMarkdown([page("A"), page("B")])).toBe("# A\n\n---\n\n# B");
  });

  it("plain text and printable html include the page's text", () => {
    const doc = page("Title", [p([{ text: "body", marks: [] }])]);
    expect(pagePlainText(doc)).toContain("Title\n\nbody");
    expect(printableHtml("x", [doc], () => undefined)).toContain("body");
  });
});
