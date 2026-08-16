import { undoInputRule } from "prosemirror-inputrules";
import { TextSelection } from "prosemirror-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProseMirrorRichTextField } from "./ProseMirrorRichTextField.js";
import {
  emptyRichTextDocument,
  type RichTextBlock,
  type RichTextCodeBlock,
  type RichTextDocument,
  type RichTextImageRun,
  type RichTextParagraphBlock,
  type RichTextTableBlock,
  type RichTextTextRun,
} from "./schema/marks.js";

/** None of the fixtures/typed-markdown flows this file exercises ever produce a `"codeBlock"`/
 *  `"table"` block or an `"image"` run — narrowing through this single helper keeps every
 *  assertion below free of per-call union-narrowing noise. Throws (rather than returning
 *  `undefined`) so callers can drop the `?.` they used to need. */
function asParagraph(block: RichTextBlock | undefined): Omit<RichTextParagraphBlock, "runs"> & {
  runs: RichTextTextRun[];
} {
  if (!block || (block.kind !== undefined && block.kind !== "paragraph")) {
    throw new Error("Expected a paragraph block");
  }
  for (const run of block.runs) {
    if (run.kind === "image") throw new Error("Expected a text run, got an image run");
  }
  return block as Omit<RichTextParagraphBlock, "runs"> & { runs: RichTextTextRun[] };
}

/** Companion to `asParagraph` for the Task C tests below, which are the first in this file to
 *  produce a `"codeBlock"` block. */
function asCodeBlock(block: RichTextBlock | undefined): RichTextCodeBlock {
  if (!block || block.kind !== "codeBlock") {
    throw new Error("Expected a codeBlock block");
  }
  return block;
}

/** Companion to `asParagraph`/`asCodeBlock` for the Task D (table) tests below. */
function asTable(block: RichTextBlock | undefined): RichTextTableBlock {
  if (!block || block.kind !== "table") {
    throw new Error("Expected a table block");
  }
  return block;
}

/** Reads a paragraph block's runs without `asParagraph`'s "no image runs" restriction — for the
 *  Task E (image) tests below, which are the first in this file to actually produce one. */
function runsOf(block: RichTextBlock | undefined): (RichTextTextRun | RichTextImageRun)[] {
  if (!block || (block.kind !== undefined && block.kind !== "paragraph")) {
    throw new Error("Expected a paragraph block");
  }
  return block.runs;
}

/** A table cell's content is a single plain paragraph in v1 (see `table_cell`'s schema doc
 *  comment) — this reads its plain text without needing a full `asParagraph` narrowing, since
 *  typed-markdown table cells never carry marks or image runs. */
function cellText(row: RichTextTableBlock["rows"][number], columnIndex: number): string {
  const cell = row.cells[columnIndex];
  if (!cell) throw new Error(`No cell at column ${columnIndex}`);
  return cell.runs.map((run) => (run.kind === "image" ? "" : run.text)).join("");
}

function fixtureDocument(): RichTextDocument {
  return {
    paragraphs: [
      {
        runs: [
          { text: "Hello ", marks: [] },
          { text: "world", marks: [{ kind: "bold" }, { kind: "italic" }] },
        ],
        listKind: "none",
        indentLevel: 0,
        tagId: null,
        headingLevel: 0,
        blockquoteDepth: 0,
      },
      {
        runs: [{ text: "underlined and struck", marks: [{ kind: "underline" }, { kind: "strikethrough" }] }],
        listKind: "bulleted",
        indentLevel: 1,
        tagId: "to-do",
        headingLevel: 0,
        blockquoteDepth: 0,
      },
      {
        runs: [
          { text: "highlighted", marks: [{ kind: "highlight", attr: "#00ff00" }] },
          { text: " and a ", marks: [] },
          { text: "link", marks: [{ kind: "link", attr: "https://renote.example/" }] },
        ],
        listKind: "numbered",
        indentLevel: 2,
        tagId: "important",
        headingLevel: 0,
        blockquoteDepth: 0,
      },
    ],
  };
}

describe("ProseMirrorRichTextField", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("round-trips text, all mark kinds, list kind, indent level, and tagId through setContent/getContent", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);

    const original = fixtureDocument();
    field.setContent(original);
    const result = field.getContent();

    expect(result.paragraphs).toHaveLength(3);
    const para0 = asParagraph(result.paragraphs[0]);
    const para1 = asParagraph(result.paragraphs[1]);
    const para2 = asParagraph(result.paragraphs[2]);

    expect(para0.runs.map((run) => run.text).join("")).toBe("Hello world");
    expect(para0.listKind).toBe("none");
    expect(para0.indentLevel).toBe(0);
    expect(para0.tagId).toBeNull();
    const boldedRun = para0.runs.find((run) => run.marks.some((mark) => mark.kind === "bold"));
    expect(boldedRun?.marks.map((mark) => mark.kind).sort()).toEqual(["bold", "italic"]);

    expect(para1.listKind).toBe("bulleted");
    expect(para1.indentLevel).toBe(1);
    expect(para1.tagId).toBe("to-do");
    expect(para1.runs[0]?.marks.map((mark) => mark.kind).sort()).toEqual(["strikethrough", "underline"]);

    expect(para2.listKind).toBe("numbered");
    expect(para2.indentLevel).toBe(2);
    expect(para2.tagId).toBe("important");
    const highlightMark = para2.runs.flatMap((run) => run.marks).find((mark) => mark.kind === "highlight");
    expect(highlightMark?.attr).toBe("#00ff00");
    const linkMark = para2.runs.flatMap((run) => run.marks).find((mark) => mark.kind === "link");
    expect(linkMark?.attr).toBe("https://renote.example/");

    field.destroy();
  });

  it("setContent before mount is picked up once mounted", () => {
    const field = new ProseMirrorRichTextField();
    field.setContent(fixtureDocument());
    field.mount(container);

    const result = field.getContent();
    expect(asParagraph(result.paragraphs[1]).tagId).toBe("to-do");

    field.destroy();
  });

  it("getContent before any mount/setContent returns an empty document", () => {
    const field = new ProseMirrorRichTextField();
    expect(field.getContent()).toEqual(emptyRichTextDocument());
  });

  it("mount attaches editor DOM to the container, and destroy removes it", () => {
    const field = new ProseMirrorRichTextField();
    expect(container.childElementCount).toBe(0);

    field.mount(container);
    expect(container.childElementCount).toBeGreaterThan(0);

    field.destroy();
    expect(container.childElementCount).toBe(0);
  });

  it("destroy is a no-op when called without a prior mount", () => {
    const field = new ProseMirrorRichTextField();
    expect(() => field.destroy()).not.toThrow();
  });

  it("destroy is a no-op when called twice", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    field.destroy();
    expect(() => field.destroy()).not.toThrow();
  });

  it("focus does not throw when called after mount", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    expect(() => field.focus()).not.toThrow();
    field.destroy();
  });

  it("focus does not throw when called before mount", () => {
    const field = new ProseMirrorRichTextField();
    expect(() => field.focus()).not.toThrow();
  });

  it("setParagraphTag sets the tagId attr on the paragraph containing the current selection", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    field.setContent(fixtureDocument());

    // EditorState.create defaults the selection to the start of the document (inside
    // paragraph 0) when none is given, which is exactly what setContent does.
    field.setParagraphTag("question");
    const result = field.getContent();
    expect(asParagraph(result.paragraphs[0]).tagId).toBe("question");
    // Untouched: setParagraphTag only ever affects the one paragraph containing the selection.
    expect(asParagraph(result.paragraphs[1]).tagId).toBe("to-do");
    expect(asParagraph(result.paragraphs[2]).tagId).toBe("important");

    field.destroy();
  });

  it("setParagraphTag(null) clears a paragraph's tagId", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    field.setContent(fixtureDocument());

    field.setParagraphTag("question");
    expect(asParagraph(field.getContent().paragraphs[0]).tagId).toBe("question");

    field.setParagraphTag(null);
    expect(asParagraph(field.getContent().paragraphs[0]).tagId).toBeNull();

    field.destroy();
  });

  it("setParagraphTag is a no-op when the field isn't mounted", () => {
    const field = new ProseMirrorRichTextField();
    field.setContent(fixtureDocument());
    expect(() => field.setParagraphTag("question")).not.toThrow();

    field.mount(container);
    // The pending (pre-mount) document is untouched — setParagraphTag had nothing to act on.
    expect(asParagraph(field.getContent().paragraphs[0]).tagId).toBeNull();
    field.destroy();
  });
});

describe("ProseMirrorRichTextField wikilink autocomplete", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  /** Types `text` one character at a time via real `insertText` transactions, mirroring how a
   *  user's keystrokes (or a paste) arrive as a sequence of doc-changing transactions — the
   *  trigger plugin reacts to transactions, not raw DOM key events, so this is enough to
   *  exercise it without simulating actual browser input. */
  function typeText(field: ProseMirrorRichTextField, text: string): void {
    const view = (field as unknown as { view: import("prosemirror-view").EditorView }).view;
    for (const char of text) {
      const { from, to } = view.state.selection;
      view.dispatch(view.state.tr.insertText(char, from, to));
    }
  }

  it("fires onWikilinkTrigger with an empty query immediately after typing [[", () => {
    const onWikilinkTrigger = vi.fn();
    const field = new ProseMirrorRichTextField({ onWikilinkTrigger });
    field.mount(container);

    typeText(field, "[[");

    expect(onWikilinkTrigger).toHaveBeenCalledTimes(1);
    const [query, range] = onWikilinkTrigger.mock.calls[0] as [string, { from: number; to: number }];
    expect(query).toBe("");
    expect(range.to - range.from).toBe(2);

    field.destroy();
  });

  it("fires onWikilinkTrigger again with the growing query as more text is typed", () => {
    const onWikilinkTrigger = vi.fn();
    const field = new ProseMirrorRichTextField({ onWikilinkTrigger });
    field.mount(container);

    typeText(field, "[[Reci");

    const lastCall = onWikilinkTrigger.mock.calls.at(-1) as [string, { from: number; to: number }];
    expect(lastCall[0]).toBe("Reci");

    field.destroy();
  });

  it("does not fire onWikilinkTrigger for unrelated typing", () => {
    const onWikilinkTrigger = vi.fn();
    const field = new ProseMirrorRichTextField({ onWikilinkTrigger });
    field.mount(container);

    typeText(field, "Hello world");

    expect(onWikilinkTrigger).not.toHaveBeenCalled();
    field.destroy();
  });

  it("insertWikilink replaces the tracked range with a wikilink-marked run", () => {
    const onWikilinkTrigger = vi.fn();
    const field = new ProseMirrorRichTextField({ onWikilinkTrigger });
    field.mount(container);

    typeText(field, "[[Recipes");
    const [, range] = onWikilinkTrigger.mock.calls.at(-1) as [string, { from: number; to: number }];

    field.insertWikilink("page-recipes", "Recipes", range);

    const result = field.getContent();
    const wikilinkRun = asParagraph(result.paragraphs[0]).runs.find((run) =>
      run.marks.some((mark) => mark.kind === "wikilink"),
    );
    expect(wikilinkRun?.text).toBe("Recipes");
    const mark = wikilinkRun?.marks.find((m) => m.kind === "wikilink");
    expect(mark?.attr).toBe("page-recipes");
    expect(mark?.attr2).toBe("Recipes");
    // The literal "[[" trigger text must be gone — replaced, not left alongside the mark.
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("Recipes");

    field.destroy();
  });

  it("insertWikilink supports linking to the current page itself (a self-reference)", () => {
    const onWikilinkTrigger = vi.fn();
    const field = new ProseMirrorRichTextField({ onWikilinkTrigger });
    field.mount(container);

    typeText(field, "[[This Page");
    const [, range] = onWikilinkTrigger.mock.calls.at(-1) as [string, { from: number; to: number }];

    // "self-page" stands in for the id of the very page being edited — nothing about
    // insertWikilink treats that as a special/rejected case.
    field.insertWikilink("self-page", "This Page", range);

    const result = field.getContent();
    const wikilinkRun = asParagraph(result.paragraphs[0]).runs.find((run) =>
      run.marks.some((mark) => mark.kind === "wikilink"),
    );
    expect(wikilinkRun?.marks.find((m) => m.kind === "wikilink")?.attr).toBe("self-page");

    field.destroy();
  });

  it("fires onWikilinkCancel when a bracket is deleted out from under an active trigger", () => {
    const onWikilinkTrigger = vi.fn();
    const onWikilinkCancel = vi.fn();
    const field = new ProseMirrorRichTextField({ onWikilinkTrigger, onWikilinkCancel });
    field.mount(container);

    typeText(field, "[[Reci");
    expect(onWikilinkTrigger).toHaveBeenCalled();

    // Backspace all the way past both brackets.
    const view = (field as unknown as { view: import("prosemirror-view").EditorView }).view;
    for (let i = 0; i < 8; i++) {
      const { from } = view.state.selection;
      if (from <= 1) break;
      view.dispatch(view.state.tr.delete(from - 1, from));
    }

    expect(onWikilinkCancel).toHaveBeenCalled();
    field.destroy();
  });

  it("cancelWikilinkTrigger leaves the typed text as plain text and stops tracking", () => {
    const onWikilinkTrigger = vi.fn();
    const onWikilinkCancel = vi.fn();
    const field = new ProseMirrorRichTextField({ onWikilinkTrigger, onWikilinkCancel });
    field.mount(container);

    typeText(field, "[[Reci");
    field.cancelWikilinkTrigger();

    expect(onWikilinkCancel).toHaveBeenCalled();
    const result = field.getContent();
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("[[Reci");
    expect(asParagraph(result.paragraphs[0]).runs.every((run) => run.marks.length === 0)).toBe(true);

    field.destroy();
  });
});

describe("ProseMirrorRichTextField markdown input rules", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  function fieldView(field: ProseMirrorRichTextField): import("prosemirror-view").EditorView {
    return (field as unknown as { view: import("prosemirror-view").EditorView }).view;
  }

  /**
   * Unlike the wikilink plugin above (which inspects every transaction post-hoc regardless of
   * origin, so the wikilink tests' plain `tr.insertText()` helper is enough), `prosemirror-
   * inputrules` hooks the EditorView's `handleTextInput` prop — the same prop real DOM text
   * input dispatches through — and never sees a transaction dispatched by calling
   * `tr.insertText()` directly. This calls that prop the same way ProseMirror's own internal
   * input handling does: give the input rules first look via `handleTextInput`, and only fall
   * back to plain insertion if none of them matched, one character at a time.
   */
  function typeText(field: ProseMirrorRichTextField, text: string): void {
    const view = fieldView(field);
    for (const char of text) {
      const { from, to } = view.state.selection;
      const deflt = () => view.state.tr.insertText(char, from, to);
      const handled = view.someProp("handleTextInput", (f) => f(view, from, to, char, deflt));
      if (!handled) {
        view.dispatch(deflt());
      }
    }
  }

  /** Invokes the exact command the `keymap({ Backspace: undoInputRule })` plugin binds Backspace
   *  to (see ProseMirrorRichTextField's constructor) — the direct, DOM-independent way to test
   *  what a real Backspace keypress does immediately after an input rule fires, without needing
   *  jsdom to route a synthetic KeyboardEvent through ProseMirror's own `handleKeyDown` prop. */
  function backspace(field: ProseMirrorRichTextField): void {
    const view = fieldView(field);
    undoInputRule(view.state, view.dispatch);
  }

  it("**bold** becomes a bold-marked run with the delimiters stripped", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "**bold**");

    const result = field.getContent();
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("bold");
    expect(asParagraph(result.paragraphs[0]).runs[0]?.marks.map((mark) => mark.kind)).toEqual(["bold"]);
    field.destroy();
  });

  it("__bold__ (underscore form) also becomes a bold-marked run", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "__bold__");

    const result = field.getContent();
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("bold");
    expect(asParagraph(result.paragraphs[0]).runs[0]?.marks.map((mark) => mark.kind)).toEqual(["bold"]);
    field.destroy();
  });

  it("*italic* becomes an italic-marked run, distinct from the bold rule", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "*italic*");

    const result = field.getContent();
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("italic");
    expect(asParagraph(result.paragraphs[0]).runs[0]?.marks.map((mark) => mark.kind)).toEqual(["italic"]);
    field.destroy();
  });

  it("_italic_ (underscore form) also becomes an italic-marked run", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "_italic_");

    const result = field.getContent();
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("italic");
    expect(asParagraph(result.paragraphs[0]).runs[0]?.marks.map((mark) => mark.kind)).toEqual(["italic"]);
    field.destroy();
  });

  it("~~strike~~ becomes a strikethrough-marked run", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "~~strike~~");

    const result = field.getContent();
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("strike");
    expect(asParagraph(result.paragraphs[0]).runs[0]?.marks.map((mark) => mark.kind)).toEqual([
      "strikethrough",
    ]);
    field.destroy();
  });

  it("preserves surrounding plain text around an inline markdown shortcut", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "say *hi* now");

    const result = field.getContent();
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("say hi now");
    const italicRun = asParagraph(result.paragraphs[0]).runs.find((run) => run.text === "hi");
    expect(italicRun?.marks.map((mark) => mark.kind)).toEqual(["italic"]);
    field.destroy();
  });

  it("[text](url) becomes a link-marked run with the markdown syntax stripped", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "[reNote](https://renote.example/)");

    const result = field.getContent();
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("reNote");
    const linkRun = asParagraph(result.paragraphs[0]).runs[0];
    expect(linkRun?.marks.map((mark) => mark.kind)).toEqual(["link"]);
    expect(linkRun?.marks[0]?.attr).toBe("https://renote.example/");
    field.destroy();
  });

  it("'- ' at the start of a paragraph makes it bulleted and removes the marker", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "- ");
    typeText(field, "item one");

    const result = field.getContent();
    expect(asParagraph(result.paragraphs[0]).listKind).toBe("bulleted");
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("item one");
    field.destroy();
  });

  it("'1. ' at the start of a paragraph makes it numbered and removes the marker", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "1. ");
    typeText(field, "item one");

    const result = field.getContent();
    expect(asParagraph(result.paragraphs[0]).listKind).toBe("numbered");
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("item one");
    field.destroy();
  });

  it("does not treat a list marker mid-sentence as a list start", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "a - b");

    const result = field.getContent();
    expect(asParagraph(result.paragraphs[0]).listKind).toBe("none");
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("a - b");
    field.destroy();
  });

  it("Backspace right after a rule fires undoes it back to the literal markdown text", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "*hi*");
    expect(asParagraph(field.getContent().paragraphs[0]).runs[0]?.marks).toHaveLength(1);

    backspace(field);

    const result = field.getContent();
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("*hi*");
    expect(asParagraph(result.paragraphs[0]).runs.every((run) => run.marks.length === 0)).toBe(true);
    field.destroy();
  });

  it.each([1, 2, 3, 4, 5, 6])(
    "'%s#'s followed by a space makes the paragraph a level-%s heading",
    (level) => {
      const field = new ProseMirrorRichTextField();
      field.mount(container);
      typeText(field, `${"#".repeat(level)} `);
      typeText(field, "Heading text");

      const result = field.getContent();
      const paragraph = asParagraph(result.paragraphs[0]);
      expect(paragraph.headingLevel).toBe(level);
      expect(paragraph.runs.map((run) => run.text).join("")).toBe("Heading text");
      field.destroy();
    },
  );

  it("does not treat 7 '#'s as a heading marker (CommonMark caps ATX headings at 6)", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "####### not a heading");

    const result = field.getContent();
    const paragraph = asParagraph(result.paragraphs[0]);
    expect(paragraph.headingLevel).toBe(0);
    expect(paragraph.runs.map((run) => run.text).join("")).toBe("####### not a heading");
    field.destroy();
  });

  it("'> ' at the start of a paragraph makes it a blockquote and removes the marker", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "> ");
    typeText(field, "quoted text");

    const result = field.getContent();
    const paragraph = asParagraph(result.paragraphs[0]);
    expect(paragraph.blockquoteDepth).toBe(1);
    expect(paragraph.runs.map((run) => run.text).join("")).toBe("quoted text");
    field.destroy();
  });

  it("'> > > ' typed as one stream nests the blockquote to depth 3", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "> > > ");
    typeText(field, "deeply quoted");

    const result = field.getContent();
    const paragraph = asParagraph(result.paragraphs[0]);
    expect(paragraph.blockquoteDepth).toBe(3);
    expect(paragraph.runs.map((run) => run.text).join("")).toBe("deeply quoted");
    field.destroy();
  });

  it("`code` becomes a code-marked run with the backticks stripped", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "`code`");

    const result = field.getContent();
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("code");
    expect(asParagraph(result.paragraphs[0]).runs[0]?.marks.map((mark) => mark.kind)).toEqual(["code"]);
    field.destroy();
  });

  it("does not let bold fire inside an unterminated backtick span (`**bold**` stays literal, code-marked)", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    // Typed char-by-char, exactly as a real keystroke stream arrives — this is the ordering bug
    // the prerequisite backtick guard fixes: without it, the bold rule would fire the instant
    // "**bold**" completes, before the closing backtick even exists.
    typeText(field, "`**bold**`");

    const result = field.getContent();
    const paragraph = asParagraph(result.paragraphs[0]);
    expect(paragraph.runs.map((run) => run.text).join("")).toBe("**bold**");
    expect(paragraph.runs.every((run) => run.marks.map((mark) => mark.kind).includes("code"))).toBe(true);
    expect(paragraph.runs.some((run) => run.marks.some((mark) => mark.kind === "bold"))).toBe(false);
    field.destroy();
  });
});

describe("ProseMirrorRichTextField fenced code blocks", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  function fieldView(field: ProseMirrorRichTextField): import("prosemirror-view").EditorView {
    return (field as unknown as { view: import("prosemirror-view").EditorView }).view;
  }

  function typeText(field: ProseMirrorRichTextField, text: string): void {
    const view = fieldView(field);
    for (const char of text) {
      const { from, to } = view.state.selection;
      const deflt = () => view.state.tr.insertText(char, from, to);
      const handled = view.someProp("handleTextInput", (f) => f(view, from, to, char, deflt));
      if (!handled) {
        view.dispatch(deflt());
      }
    }
  }

  /** Dispatches a real "keydown" DOM event at the view's editable element, exactly as a browser
   *  would for an actual keypress — this routes through `EditorView`'s own `handleKeyDown` prop
   *  and the `keymap` plugins bound in `ProseMirrorRichTextField`'s constructor, so it exercises
   *  the real plugin-ordering behavior (fence-line Enter tried before `baseKeymap`'s Enter, etc.)
   *  rather than calling any one command function directly. `ctrlKey` stands in for `Mod` — under
   *  jsdom, `navigator.platform` never matches prosemirror-keymap's Mac detection, so `Mod`
   *  normalizes to `Ctrl` here (see prosemirror-keymap's `normalizeKeyName`). */
  function pressKey(field: ProseMirrorRichTextField, key: string, opts: { ctrlKey?: boolean } = {}): void {
    const view = fieldView(field);
    const event = new KeyboardEvent("keydown", {
      key,
      ctrlKey: opts.ctrlKey ?? false,
      bubbles: true,
      cancelable: true,
    });
    view.dom.dispatchEvent(event);
  }

  it("```lang followed by Enter replaces the paragraph with an empty code_block carrying that language", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "```ts");
    pressKey(field, "Enter");

    const result = field.getContent();
    expect(result.paragraphs).toHaveLength(1);
    const codeBlock = asCodeBlock(result.paragraphs[0]);
    expect(codeBlock.text).toBe("");
    expect(codeBlock.language).toBe("ts");
    field.destroy();
  });

  it("```(no language) followed by Enter creates a code_block with a null language", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "```");
    pressKey(field, "Enter");

    const codeBlock = asCodeBlock(field.getContent().paragraphs[0]);
    expect(codeBlock.language).toBeNull();
    field.destroy();
  });

  it("typing inside an open code_block is stored verbatim, with no markdown input rules applied", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "```js");
    pressKey(field, "Enter");
    typeText(field, "**not bold** `not code either`");

    const codeBlock = asCodeBlock(field.getContent().paragraphs[0]);
    expect(codeBlock.text).toBe("**not bold** `not code either`");
    field.destroy();
  });

  it("plain Enter inside an open code_block inserts a newline rather than splitting the block", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "```");
    pressKey(field, "Enter");
    typeText(field, "line one");
    pressKey(field, "Enter");
    typeText(field, "line two");

    const result = field.getContent();
    expect(result.paragraphs).toHaveLength(1);
    expect(asCodeBlock(result.paragraphs[0]).text).toBe("line one\nline two");
    field.destroy();
  });

  it("Mod-Enter exits an open code_block into a new trailing paragraph", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "```");
    pressKey(field, "Enter");
    typeText(field, "const x = 1;");
    pressKey(field, "Enter", { ctrlKey: true });
    typeText(field, "after");

    const result = field.getContent();
    expect(result.paragraphs).toHaveLength(2);
    expect(asCodeBlock(result.paragraphs[0]).text).toBe("const x = 1;");
    expect(
      asParagraph(result.paragraphs[1])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("after");
    field.destroy();
  });

  it("a paragraph that merely contains a fence line without a trailing Enter is untouched", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "see ```ts for example");

    const result = field.getContent();
    expect(result.paragraphs).toHaveLength(1);
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("see ```ts for example");
    field.destroy();
  });
});

describe("ProseMirrorRichTextField GFM tables", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  function fieldView(field: ProseMirrorRichTextField): import("prosemirror-view").EditorView {
    return (field as unknown as { view: import("prosemirror-view").EditorView }).view;
  }

  function typeText(field: ProseMirrorRichTextField, text: string): void {
    const view = fieldView(field);
    for (const char of text) {
      const { from, to } = view.state.selection;
      const deflt = () => view.state.tr.insertText(char, from, to);
      const handled = view.someProp("handleTextInput", (f) => f(view, from, to, char, deflt));
      if (!handled) {
        view.dispatch(deflt());
      }
    }
  }

  /** Real "keydown" Enter, same as `pressKey` in the fenced-code-block describe block above —
   *  routes through `baseKeymap`'s own Enter (plain paragraph split), which is what actually
   *  produces the second/third "paragraph" a table's header/separator/append rows are typed
   *  into, one per line. */
  function pressEnter(field: ProseMirrorRichTextField): void {
    const view = fieldView(field);
    view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  }

  /** Types a full "| a | b |\n" GFM row followed by Enter — the shape every row (header,
   *  separator, appended) is typed in. */
  function typeRow(field: ProseMirrorRichTextField, row: string): void {
    typeText(field, row);
    pressEnter(field);
  }

  it("a header row followed by a separator row becomes a single-row table with a trailing paragraph", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "| Name | Age |");
    pressEnter(field);
    typeText(field, "|---|---|");
    pressEnter(field);

    const result = field.getContent();
    expect(result.paragraphs).toHaveLength(2);
    const table = asTable(result.paragraphs[0]);
    expect(table.rows).toHaveLength(1);
    expect(table.headerRowCount).toBe(1);
    expect(cellText(table.rows[0]!, 0)).toBe("Name");
    expect(cellText(table.rows[0]!, 1)).toBe("Age");
    // The trailing paragraph exists so the user isn't trapped inside the table afterward.
    expect(asParagraph(result.paragraphs[1]).runs).toHaveLength(0);
    field.destroy();
  });

  it("trims whitespace around each cell's text", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "|  Name  |  Age  |");
    pressEnter(field);
    typeText(field, "| --- | --- |");
    pressEnter(field);

    const table = asTable(field.getContent().paragraphs[0]);
    expect(cellText(table.rows[0]!, 0)).toBe("Name");
    expect(cellText(table.rows[0]!, 1)).toBe("Age");
    field.destroy();
  });

  it("a pipe row typed directly below an existing table appends a new row", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeRow(field, "| Name | Age |");
    typeText(field, "|---|---|");
    pressEnter(field);
    typeText(field, "| Alice | 30 |");
    pressEnter(field);

    const table = asTable(field.getContent().paragraphs[0]);
    expect(table.rows).toHaveLength(2);
    expect(cellText(table.rows[1]!, 0)).toBe("Alice");
    expect(cellText(table.rows[1]!, 1)).toBe("30");
    field.destroy();
  });

  it("appending a row still leaves exactly one table block plus a (still-empty) trailing paragraph", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeRow(field, "| Name | Age |");
    typeRow(field, "|---|---|");
    typeRow(field, "| Alice | 30 |");

    const result = field.getContent();
    expect(result.paragraphs).toHaveLength(2);
    expect(asTable(result.paragraphs[0]).rows).toHaveLength(2);
    expect(asParagraph(result.paragraphs[1]).runs).toHaveLength(0);
    field.destroy();
  });

  it("supports appending two rows back to back (regression: the first append must leave the cursor in a fresh trailing paragraph, not inside the new row's own cell, or the second row's text lands inside the first appended row's cell instead of becoming its own row)", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeRow(field, "| Name | Age |");
    typeRow(field, "|---|---|");
    typeRow(field, "| Alice | 30 |");
    typeRow(field, "| Bob | 25 |");

    const result = field.getContent();
    expect(result.paragraphs).toHaveLength(2);
    const table = asTable(result.paragraphs[0]);
    expect(table.rows).toHaveLength(3);
    expect(cellText(table.rows[1]!, 0)).toBe("Alice");
    expect(cellText(table.rows[2]!, 0)).toBe("Bob");
    expect(cellText(table.rows[2]!, 1)).toBe("25");
    expect(asParagraph(result.paragraphs[1]).runs).toHaveLength(0);
    field.destroy();
  });

  it("tolerates a mismatched cell count on an appended row rather than throwing", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeRow(field, "| Name | Age |");
    typeText(field, "|---|---|");
    pressEnter(field);
    expect(() => typeRow(field, "| Only one |")).not.toThrow();

    const table = asTable(field.getContent().paragraphs[0]);
    expect(table.rows).toHaveLength(2);
    expect(cellText(table.rows[1]!, 0)).toBe("Only one");
    field.destroy();
  });

  it("does not create a table from a lone pipe row with no preceding row (Enter just splits the paragraph normally)", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "|---|---|");
    pressEnter(field);

    const result = field.getContent();
    expect(result.paragraphs).toHaveLength(2);
    expect(
      asParagraph(result.paragraphs[0])
        .runs.map((run) => run.text)
        .join(""),
    ).toBe("|---|---|");
    field.destroy();
  });
});

describe("ProseMirrorRichTextField markdown images", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  function fieldView(field: ProseMirrorRichTextField): import("prosemirror-view").EditorView {
    return (field as unknown as { view: import("prosemirror-view").EditorView }).view;
  }

  function typeText(field: ProseMirrorRichTextField, text: string): void {
    const view = fieldView(field);
    for (const char of text) {
      const { from, to } = view.state.selection;
      const deflt = () => view.state.tr.insertText(char, from, to);
      const handled = view.someProp("handleTextInput", (f) => f(view, from, to, char, deflt));
      if (!handled) {
        view.dispatch(deflt());
      }
    }
  }

  it("![alt](https://...) becomes an image run with the markdown syntax stripped", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "![a cat](https://example.com/cat.png)");

    const runs = runsOf(field.getContent().paragraphs[0]);
    expect(runs).toHaveLength(1);
    const run = runs[0] as RichTextImageRun;
    expect(run.kind).toBe("image");
    expect(run.src).toBe("https://example.com/cat.png");
    expect(run.alt).toBe("a cat");
    field.destroy();
  });

  it("![alt](url) with an http:// (non-https) URL also becomes an image run", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "![cat](http://example.com/cat.png)");

    const run = runsOf(field.getContent().paragraphs[0])[0] as RichTextImageRun;
    expect(run.kind).toBe("image");
    expect(run.src).toBe("http://example.com/cat.png");
    field.destroy();
  });

  it("does not convert a local (non-http(s)) image path — falls through as literal text", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "![cat](./local-cat.png)");

    const runs = runsOf(field.getContent().paragraphs[0]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.kind).not.toBe("image");
    expect((runs[0] as RichTextTextRun).text).toBe("![cat](./local-cat.png)");
    field.destroy();
  });

  it("preserves surrounding text around an inline image", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "see ![cat](https://example.com/cat.png) here");

    const runs = runsOf(field.getContent().paragraphs[0]);
    expect(runs.map((run) => (run.kind === "image" ? "[img]" : run.text)).join("")).toBe("see [img] here");
    field.destroy();
  });

  it("an image with empty alt text round-trips with alt as an empty string", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "![](https://example.com/cat.png)");

    const run = runsOf(field.getContent().paragraphs[0])[0] as RichTextImageRun;
    expect(run.alt).toBe("");
    field.destroy();
  });

  it("resolves image-vs-link ordering correctly: ![alt](url) never becomes a link", () => {
    // Regression test for imageInputRule needing to precede linkInputRule — InputRule regexes
    // aren't `^`-anchored, so linkInputRule's own pattern also matches the "[alt](url)" tail of
    // "![alt](url)$"; if link's rule ran first it would win and produce a link with a stray "!"
    // left over as plain text, instead of an image.
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "![cat](https://example.com/cat.png)");

    const runs = runsOf(field.getContent().paragraphs[0]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.kind).toBe("image");
    const hasLinkMark =
      runs[0]?.kind !== "image" && (runs[0] as RichTextTextRun).marks.some((mark) => mark.kind === "link");
    expect(hasLinkMark).toBe(false);
    field.destroy();
  });

  it("still converts an ordinary [text](url) link when no leading ! is present", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "[reNote](https://renote.example/)");

    const runs = runsOf(field.getContent().paragraphs[0]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.kind).not.toBe("image");
    const textRun = runs[0] as RichTextTextRun;
    expect(textRun.text).toBe("reNote");
    expect(textRun.marks.map((mark) => mark.kind)).toEqual(["link"]);
    field.destroy();
  });
});

describe("ProseMirrorRichTextField setTextColor", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  function fieldView(field: ProseMirrorRichTextField): import("prosemirror-view").EditorView {
    return (field as unknown as { view: import("prosemirror-view").EditorView }).view;
  }

  function typeText(field: ProseMirrorRichTextField, text: string): void {
    const view = fieldView(field);
    for (const char of text) {
      const { from, to } = view.state.selection;
      const deflt = () => view.state.tr.insertText(char, from, to);
      const handled = view.someProp("handleTextInput", (f) => f(view, from, to, char, deflt));
      if (!handled) {
        view.dispatch(deflt());
      }
    }
  }

  /** Selects `text`'s full range within the (single, first-paragraph) content typed so far —
   *  every test in this block types exactly one run of plain text first, so "select all of it"
   *  is always `[1, 1 + text.length]` (position 1 is the start of the first paragraph's content,
   *  same convention `markdown-reveal-plugin.test.ts` documents). */
  function selectAll(field: ProseMirrorRichTextField, text: string): void {
    const view = fieldView(field);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 1 + text.length)));
  }

  it("applies the textColor mark over the current selection", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "hello");
    selectAll(field, "hello");

    field.setTextColor("#ff00ff");

    const result = field.getContent();
    const run = runsOf(result.paragraphs[0])[0] as RichTextTextRun;
    expect(run.marks.map((mark) => mark.kind)).toEqual(["textColor"]);
    expect(run.marks[0]?.attr).toBe("#ff00ff");
    field.destroy();
  });

  it("setTextColor(null) clears a previously applied color", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "hello");
    selectAll(field, "hello");
    field.setTextColor("#ff00ff");

    selectAll(field, "hello");
    field.setTextColor(null);

    const run = runsOf(field.getContent().paragraphs[0])[0] as RichTextTextRun;
    expect(run.marks).toEqual([]);
    field.destroy();
  });

  it("re-applying a different color replaces the mark rather than stacking a second one", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "hello");
    selectAll(field, "hello");
    field.setTextColor("#ff00ff");

    selectAll(field, "hello");
    field.setTextColor("#00ff00");

    const run = runsOf(field.getContent().paragraphs[0])[0] as RichTextTextRun;
    expect(run.marks).toHaveLength(1);
    expect(run.marks[0]?.attr).toBe("#00ff00");
    field.destroy();
  });

  it("is a no-op on a collapsed (empty) selection", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "hello");
    // No explicit selectAll — cursor is left collapsed at the end of "hello" by typeText.

    field.setTextColor("#ff00ff");

    const run = runsOf(field.getContent().paragraphs[0])[0] as RichTextTextRun;
    expect(run.marks).toEqual([]);
    field.destroy();
  });

  it("is a no-op when the field isn't mounted", () => {
    const field = new ProseMirrorRichTextField();
    expect(() => field.setTextColor("#ff00ff")).not.toThrow();
  });

  it("only affects the selected run, not surrounding plain text", () => {
    const field = new ProseMirrorRichTextField();
    field.mount(container);
    typeText(field, "before middle after");
    const view = fieldView(field);
    const start = 1 + "before ".length;
    const end = start + "middle".length;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, end)));

    field.setTextColor("#ff00ff");

    const runs = runsOf(field.getContent().paragraphs[0]) as RichTextTextRun[];
    const coloredRun = runs.find((run) => run.marks.some((mark) => mark.kind === "textColor"));
    expect(coloredRun?.text).toBe("middle");
    const plainRuns = runs.filter((run) => run !== coloredRun);
    expect(plainRuns.every((run) => run.marks.length === 0)).toBe(true);
    field.destroy();
  });
});
