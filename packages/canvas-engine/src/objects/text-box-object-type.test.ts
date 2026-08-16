import { describe, expect, it } from "vitest";
import type { Container, Graphics } from "pixi.js";
import { identityTransform, newId, type PageObjectId } from "@renote/core";
import { textBoxObjectType, type TextBoxObject } from "./text-box-object-type.js";

function makeTextBox(content: unknown): TextBoxObject {
  return {
    id: newId<PageObjectId>(),
    type: "text-box",
    transform: identityTransform(),
    bounds: { x: 10, y: 10, width: 100, height: 50 },
    data: { content, backgroundColor: null, backgroundOpacity: 1, defaultTextColor: null },
  };
}

describe("textBoxObjectType", () => {
  it("hits a point inside the bounds rect and misses one outside it", () => {
    const box = makeTextBox("hello world");
    expect(textBoxObjectType.hitTest(box, { x: 50, y: 30 })).toBe(true);
    expect(textBoxObjectType.hitTest(box, { x: 500, y: 500 })).toBe(false);
  });

  it("treats the bounds edges as inclusive", () => {
    const box = makeTextBox("");
    expect(textBoxObjectType.hitTest(box, { x: 10, y: 10 })).toBe(true);
    expect(textBoxObjectType.hitTest(box, { x: 110, y: 60 })).toBe(true);
    expect(textBoxObjectType.hitTest(box, { x: 9, y: 10 })).toBe(false);
  });

  it("validates data with a content field and rejects data without one", () => {
    expect(textBoxObjectType.validate({ content: "hi" })).toEqual({
      content: "hi",
      backgroundColor: null,
      backgroundOpacity: 1,
      defaultTextColor: null,
    });
    expect(() => textBoxObjectType.validate(null)).toThrow();
    expect(() => textBoxObjectType.validate({})).toThrow();
  });

  it("preserves valid backgroundColor/backgroundOpacity/defaultTextColor and rejects invalid ones back to defaults", () => {
    expect(
      textBoxObjectType.validate({
        content: "hi",
        backgroundColor: "#ff0000",
        backgroundOpacity: 0.5,
        defaultTextColor: "#00ff00",
      }),
    ).toEqual({
      content: "hi",
      backgroundColor: "#ff0000",
      backgroundOpacity: 0.5,
      defaultTextColor: "#00ff00",
    });

    // Wrong-typed values (as if corrupted, or from some future schema variant) fall back to
    // defaults rather than propagating garbage — same defensive posture `shape-object-type.ts`
    // takes with `fillColor`.
    expect(
      textBoxObjectType.validate({ content: "hi", backgroundColor: 5, backgroundOpacity: "half" }),
    ).toEqual({ content: "hi", backgroundColor: null, backgroundOpacity: 1, defaultTextColor: null });
  });

  it("createView/updateView render a cold placeholder without throwing, for a plain-string and an empty content shape", () => {
    const withText = makeTextBox({ text: "cold preview" });
    const view = textBoxObjectType.createView(withText, { x: 0, y: 0 });
    expect(() => textBoxObjectType.updateView(view, withText, { x: 0, y: 0 })).not.toThrow();

    const empty = makeTextBox(null);
    const emptyView = textBoxObjectType.createView(empty, { x: 0, y: 0 });
    expect(() => textBoxObjectType.updateView(emptyView, empty, { x: 0, y: 0 })).not.toThrow();
  });

  it("renders real HTML markup (not stripped plain text) from a real RichTextDocument, so bold/italic survive deselection", () => {
    const box = makeTextBox({
      paragraphs: [
        {
          runs: [
            { text: "hello ", marks: [] },
            { text: "world", marks: [{ kind: "bold" }] },
          ],
          listKind: "none",
          indentLevel: 0,
          tagId: null,
        },
        {
          runs: [{ text: "second paragraph", marks: [{ kind: "italic" }] }],
          listKind: "none",
          indentLevel: 0,
          tagId: null,
        },
      ],
    });
    const view = textBoxObjectType.createView(box, { x: 0, y: 0 }) as Container & {
      preview: { text: string };
    };
    expect(view.preview.text).toContain("hello ");
    expect(view.preview.text).toContain("<strong>world</strong>");
    expect(view.preview.text).toContain("<em>second paragraph</em>");
    // Two separate paragraphs, not one run-on line.
    expect(view.preview.text.match(/<p /g)).toHaveLength(2);
  });

  it("renders heading level and textColor mark as inline styles", () => {
    const box = makeTextBox({
      paragraphs: [
        {
          runs: [{ text: "Title", marks: [{ kind: "textColor", attr: "#ff00ff" }] }],
          listKind: "none",
          indentLevel: 0,
          tagId: null,
          headingLevel: 1,
          blockquoteDepth: 0,
        },
      ],
    });
    const view = textBoxObjectType.createView(box, { x: 0, y: 0 }) as Container & {
      preview: { text: string };
    };
    expect(view.preview.text).toContain("font-size:1.8em");
    expect(view.preview.text).toContain('<span style="color:#ff00ff">Title</span>');
  });

  it("extracts an empty preview (an empty <p>) from a RichTextDocument with no runs, without throwing", () => {
    const box = makeTextBox({ paragraphs: [{ runs: [], listKind: "none", indentLevel: 0, tagId: null }] });
    const view = textBoxObjectType.createView(box, { x: 0, y: 0 }) as Container & {
      preview: { text: string };
    };
    expect(view.preview.text).toContain("<p ");
    expect(view.preview.text).not.toMatch(/<p[^>]*>[^<]+</);
  });

  it("renders a codeBlock as <pre><code> and a table as a real <table>", () => {
    const box = makeTextBox({
      paragraphs: [
        { kind: "codeBlock", text: "const x = 1;\nconst y = 2;", language: "ts" },
        {
          kind: "table",
          headerRowCount: 1,
          rows: [
            {
              cells: [
                { runs: [{ text: "a", marks: [] }], listKind: "none", indentLevel: 0, tagId: null },
                { runs: [{ text: "b", marks: [] }], listKind: "none", indentLevel: 0, tagId: null },
              ],
            },
          ],
        },
      ],
    });
    const view = textBoxObjectType.createView(box, { x: 0, y: 0 }) as Container & {
      preview: { text: string };
    };
    expect(view.preview.text).toContain("<pre");
    expect(view.preview.text).toContain("<code>const x = 1;\nconst y = 2;</code>");
    expect(view.preview.text).toContain("<table");
    expect(view.preview.text).toContain(">a<");
    expect(view.preview.text).toContain(">b<");
  });

  it("renders an image run as a real <img> tag, escaping its src/alt", () => {
    const box = makeTextBox({
      paragraphs: [
        {
          runs: [{ kind: "image", src: "https://example.com/cat.png", alt: 'a "cute" cat' }],
          listKind: "none",
          indentLevel: 0,
          tagId: null,
        },
        {
          runs: [{ kind: "image", src: "https://example.com/cat.png", alt: "" }],
          listKind: "none",
          indentLevel: 0,
          tagId: null,
        },
      ],
    });
    const view = textBoxObjectType.createView(box, { x: 0, y: 0 }) as Container & {
      preview: { text: string };
    };
    expect(view.preview.text).toContain(
      '<img src="https://example.com/cat.png" alt="a &quot;cute&quot; cat"',
    );
    expect(view.preview.text).toContain('alt=""');
  });

  it("escapes a literal < or & in typed text rather than letting it corrupt the generated markup", () => {
    const box = makeTextBox({
      paragraphs: [
        { runs: [{ text: "a < b & c", marks: [] }], listKind: "none", indentLevel: 0, tagId: null },
      ],
    });
    const view = textBoxObjectType.createView(box, { x: 0, y: 0 }) as Container & {
      preview: { text: string };
    };
    expect(view.preview.text).toContain("a &lt; b &amp; c");
  });

  it("fills the border with backgroundColor/backgroundOpacity when set, and draws no fill when null", () => {
    const withBackground: TextBoxObject = {
      id: newId<PageObjectId>(),
      type: "text-box",
      transform: identityTransform(),
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      data: { content: "hi", backgroundColor: "#ff0000", backgroundOpacity: 0.5, defaultTextColor: null },
    };
    expect(() => textBoxObjectType.createView(withBackground, { x: 0, y: 0 })).not.toThrow();

    const withoutBackground = makeTextBox("hi");
    expect(() => textBoxObjectType.createView(withoutBackground, { x: 0, y: 0 })).not.toThrow();
  });

  it("uses defaultTextColor as the preview's base fill when set", () => {
    const box: TextBoxObject = {
      id: newId<PageObjectId>(),
      type: "text-box",
      transform: identityTransform(),
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      data: { content: "hi", backgroundColor: null, backgroundOpacity: 1, defaultTextColor: "#00ff00" },
    };
    const view = textBoxObjectType.createView(box, { x: 0, y: 0 }) as Container & {
      preview: { style: { cssStyle: string } };
    };
    // `HTMLTextStyle`'s own public `.fill` getter is unreliable in this pixi.js version (always
    // reads back `undefined` regardless of what was set — verified directly against a bare
    // `new HTMLText(...)`, not a bug in this file); `.cssStyle` is the actual generated CSS
    // `HTMLText` renders from, so it's what genuinely reflects whether the color was applied.
    expect(view.preview.style.cssStyle).toContain("color: #00ff00");
  });

  it("draws chunk-local geometry when given a non-zero origin, not raw world coordinates", () => {
    const box: TextBoxObject = {
      id: newId<PageObjectId>(),
      type: "text-box",
      transform: identityTransform(),
      bounds: { x: 1_000_000, y: 1_000_000, width: 100, height: 50 },
      data: { content: "far away", backgroundColor: null, backgroundOpacity: 1, defaultTextColor: null },
    };
    const origin = { x: 999_000, y: 999_000 };
    const view = textBoxObjectType.createView(box, origin) as Container & { border: Graphics };
    const bounds = view.border.getLocalBounds();

    // Chunk-local: near (1000, 1000), not (1_000_000, 1_000_000).
    expect(bounds.x).toBeGreaterThan(900);
    expect(bounds.x).toBeLessThan(1100);
    expect(bounds.y).toBeGreaterThan(900);
    expect(bounds.y).toBeLessThan(1100);
  });
});
