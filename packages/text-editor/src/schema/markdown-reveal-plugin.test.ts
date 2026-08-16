import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { richTextDocumentToProseMirrorDoc } from "./document-conversion.js";
import type { RichTextDocument } from "./marks.js";
import { markdownRevealPlugin } from "./markdown-reveal-plugin.js";
import { richTextSchema } from "./prosemirror-schema.js";

function mountView(document: RichTextDocument, container: HTMLElement): EditorView {
  const state = EditorState.create({
    schema: richTextSchema,
    doc: richTextDocumentToProseMirrorDoc(document),
    plugins: [markdownRevealPlugin],
  });
  return new EditorView(container, { state });
}

function setSelection(view: EditorView, pos: number): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

function delimiterTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".renote-md-delim")).map((el) => el.textContent ?? "");
}

describe("markdownRevealPlugin", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  const boldDoc: RichTextDocument = {
    paragraphs: [
      {
        runs: [
          { text: "before ", marks: [] },
          { text: "bold", marks: [{ kind: "bold" }] },
          { text: " after", marks: [] },
        ],
        listKind: "none",
        indentLevel: 0,
        tagId: null,
        headingLevel: 0,
        blockquoteDepth: 0,
      },
    ],
  };

  it("shows ** delimiters around a bold span only while the selection touches it", () => {
    const view = mountView(boldDoc, container);

    // "before " occupies positions 1-8, "bold" occupies 8-12 (paragraph content starts at 1).
    setSelection(view, 10);
    expect(delimiterTexts(container)).toEqual(["**", "**"]);

    setSelection(view, 3);
    expect(delimiterTexts(container)).toEqual([]);

    view.destroy();
  });

  it("shows the delimiters when the cursor sits exactly at the mark's boundary", () => {
    const view = mountView(boldDoc, container);

    setSelection(view, 8);
    expect(delimiterTexts(container)).toEqual(["**", "**"]);

    setSelection(view, 12);
    expect(delimiterTexts(container)).toEqual(["**", "**"]);

    view.destroy();
  });

  it("reveals the correct delimiter characters per mark kind (italic, strikethrough, code)", () => {
    const doc: RichTextDocument = {
      paragraphs: [
        {
          runs: [
            { text: "i", marks: [{ kind: "italic" }] },
            { text: " s", marks: [{ kind: "strikethrough" }] },
            { text: " c", marks: [{ kind: "code" }] },
          ],
          listKind: "none",
          indentLevel: 0,
          tagId: null,
          headingLevel: 0,
          blockquoteDepth: 0,
        },
      ],
    };
    const view = mountView(doc, container);

    // italic "i" at position 1-2.
    setSelection(view, 1);
    expect(delimiterTexts(container)).toEqual(["*", "*"]);

    // strikethrough " s" at position 2-4.
    setSelection(view, 3);
    expect(delimiterTexts(container)).toEqual(["~~", "~~"]);

    // code " c" at position 4-6.
    setSelection(view, 5);
    expect(delimiterTexts(container)).toEqual(["`", "`"]);

    view.destroy();
  });

  it("shows [ and ](href) around a link span only while the selection touches it", () => {
    const doc: RichTextDocument = {
      paragraphs: [
        {
          runs: [
            { text: "click ", marks: [] },
            { text: "here", marks: [{ kind: "link", attr: "https://example.com/" }] },
          ],
          listKind: "none",
          indentLevel: 0,
          tagId: null,
          headingLevel: 0,
          blockquoteDepth: 0,
        },
      ],
    };
    const view = mountView(doc, container);

    // "click " occupies 1-7, "here" occupies 7-11.
    setSelection(view, 9);
    expect(delimiterTexts(container)).toEqual(["[", "](https://example.com/)"]);

    setSelection(view, 3);
    expect(delimiterTexts(container)).toEqual([]);

    view.destroy();
  });

  it("never reveals delimiters for a wikilink mark (dedicated [[ autocomplete UX instead)", () => {
    const doc: RichTextDocument = {
      paragraphs: [
        {
          runs: [{ text: "Recipes", marks: [{ kind: "wikilink", attr: "page-recipes", attr2: "Recipes" }] }],
          listKind: "none",
          indentLevel: 0,
          tagId: null,
          headingLevel: 0,
          blockquoteDepth: 0,
        },
      ],
    };
    const view = mountView(doc, container);

    setSelection(view, 3);
    expect(delimiterTexts(container)).toEqual([]);

    view.destroy();
  });
});
