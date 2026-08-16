import { identityTransform, type PageObject, type PageObjectId } from "@renote/core";
import { describe, expect, it } from "vitest";
import {
  findAnchorObject,
  findMatchingObjects,
  firstWikilinkOf,
  linkButtonTarget,
  linkChipTarget,
  listPageAnchors,
} from "./page-anchors.js";

function textBox(id: string, paragraphs: unknown[], x = 0): PageObject {
  return {
    id: id as PageObjectId,
    type: "text-box",
    transform: identityTransform(),
    bounds: { x, y: 0, width: 100, height: 20 },
    data: { content: { paragraphs }, backgroundColor: null, backgroundOpacity: 1, defaultTextColor: null },
  } as PageObject;
}

function paragraph(text: string, headingLevel = 0, marks: unknown[] = []) {
  return {
    runs: [{ text, marks }],
    listKind: "none",
    indentLevel: 0,
    tagId: null,
    headingLevel,
    blockquoteDepth: 0,
  };
}

const heading = textBox("a", [paragraph("Setup", 2), paragraph("plain body text")]);
const other = textBox("b", [paragraph("Results", 1)], 500);
const link = textBox("c", [
  paragraph("Setup", 0, [{ kind: "wikilink", attr: "page-9", attr2: "Recipes", attr3: "Setup" }]),
]);

describe("listPageAnchors", () => {
  it("lists heading paragraphs only, in scene order", () => {
    expect(listPageAnchors([heading, other])).toEqual(["Setup", "Results"]);
  });

  it("ignores objects with no rich-text content", () => {
    const ink = { ...heading, type: "ink-stroke", data: { points: [] } } as unknown as PageObject;
    expect(listPageAnchors([ink])).toEqual([]);
  });

  it("drops duplicate heading text", () => {
    expect(listPageAnchors([heading, textBox("d", [paragraph("Setup", 3)])])).toEqual(["Setup"]);
  });
});

describe("findAnchorObject", () => {
  it("finds the object holding the heading", () => {
    expect(findAnchorObject([other, heading], "Setup")?.id).toBe("a");
  });

  it("does not match a non-heading paragraph with the same text", () => {
    expect(findAnchorObject([link], "Setup")).toBeUndefined();
  });

  it("returns undefined for a heading that no longer exists", () => {
    expect(findAnchorObject([heading], "Gone")).toBeUndefined();
  });
});

describe("firstWikilinkOf", () => {
  it("reads page id, display text, and anchor off the mark", () => {
    expect(firstWikilinkOf(link)).toEqual({ pageId: "page-9", displayText: "Recipes", anchor: "Setup" });
  });

  it("reports no anchor for a plain whole-page link", () => {
    const plain = textBox("e", [
      paragraph("Recipes", 0, [{ kind: "wikilink", attr: "page-9", attr2: "Recipes" }]),
    ]);
    expect(firstWikilinkOf(plain)).toEqual({ pageId: "page-9", displayText: "Recipes", anchor: null });
  });

  it("returns null for a box with no link", () => {
    expect(firstWikilinkOf(heading)).toBeNull();
  });
});

describe("linkButtonTarget", () => {
  function linkButton(target: unknown): PageObject {
    return {
      id: "lb" as PageObjectId,
      type: "link-button",
      transform: identityTransform(),
      bounds: { x: 0, y: 0, width: 180, height: 30 },
      data: { target },
    } as PageObject;
  }

  it("reads a targeted button", () => {
    const object = linkButton({ kind: "wikilink", attr: "page-9", attr2: "Recipes", attr3: "Setup" });
    expect(linkButtonTarget(object)).toEqual({ pageId: "page-9", displayText: "Recipes", anchor: "Setup" });
  });

  it("returns null for a button with no target picked yet", () => {
    expect(linkButtonTarget(linkButton(null))).toBeNull();
  });

  it("returns null for any other object type", () => {
    expect(linkButtonTarget(link)).toBeNull();
  });
});

describe("linkChipTarget", () => {
  it("follows a box that is nothing but one link", () => {
    expect(linkChipTarget(link)?.pageId).toBe("page-9");
  });

  it("ignores a link buried in prose, which stays click-to-select", () => {
    const prose = textBox("f", [
      {
        runs: [
          { text: "see ", marks: [] },
          { text: "Recipes", marks: [{ kind: "wikilink", attr: "page-9", attr2: "Recipes" }] },
        ],
        listKind: "none",
        indentLevel: 0,
        tagId: null,
        headingLevel: 0,
        blockquoteDepth: 0,
      },
    ]);
    expect(firstWikilinkOf(prose)?.pageId).toBe("page-9");
    expect(linkChipTarget(prose)).toBeNull();
  });

  it("ignores a multi-paragraph box", () => {
    const linkPlusText = textBox("g", [
      paragraph("Recipes", 0, [{ kind: "wikilink", attr: "page-9", attr2: "Recipes" }]),
      paragraph("more"),
    ]);
    expect(linkChipTarget(linkPlusText)).toBeNull();
  });
});

describe("findMatchingObjects", () => {
  it("matches case-insensitively across objects, in scene order", () => {
    expect(findMatchingObjects([heading, other], "setup").map((o) => o.id)).toEqual(["a"]);
    expect(findMatchingObjects([heading, other], "RESULTS").map((o) => o.id)).toEqual(["b"]);
  });

  it("matches on any part of the object's joined text, not just a whole block", () => {
    expect(findMatchingObjects([heading], "plain body").map((o) => o.id)).toEqual(["a"]);
  });

  it("returns nothing for an empty or whitespace-only query", () => {
    expect(findMatchingObjects([heading, other], "")).toEqual([]);
    expect(findMatchingObjects([heading, other], "   ")).toEqual([]);
  });

  it("returns nothing when no object matches", () => {
    expect(findMatchingObjects([heading, other], "nonexistent")).toEqual([]);
  });

  it("ignores objects with no rich-text content", () => {
    const ink = { ...heading, type: "ink-stroke", data: { points: [] } } as unknown as PageObject;
    expect(findMatchingObjects([ink], "setup")).toEqual([]);
  });
});
