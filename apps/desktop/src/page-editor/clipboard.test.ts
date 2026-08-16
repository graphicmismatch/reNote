import { describe, expect, it } from "vitest";
import { identityTransform, type PageObject, type PageObjectId } from "@renote/core";
import type { RichTextDocument, RichTextParagraphBlock, RichTextTextRun } from "@renote/text-editor";
import {
  assetPathsOf,
  centerObjectsOn,
  decodeObjects,
  encodeObjects,
  groupBounds,
  plainTextContent,
  remapAssetPaths,
  translateObjects,
  withFreshIds,
} from "./clipboard.js";

const SOURCE = { notebookId: "n1", sectionId: "s1", pageId: "p1" };

function object(id: string, x: number, y: number, data: unknown = {}): PageObject {
  return {
    id: id as PageObjectId,
    type: "text-box",
    transform: identityTransform(),
    bounds: { x, y, width: 100, height: 50 },
    data,
  };
}

describe("clipboard envelope", () => {
  it("round-trips objects and their source page", () => {
    const decoded = decodeObjects(encodeObjects([object("a", 0, 0)], SOURCE));
    expect(decoded?.source).toEqual(SOURCE);
    expect(decoded?.objects).toHaveLength(1);
    expect(decoded?.objects[0]?.id).toBe("a");
  });

  it("ignores clipboard text that isn't ours", () => {
    expect(decodeObjects("just some copied words")).toBeNull();
    expect(decodeObjects('{"kind":"something/else","objects":[]}')).toBeNull();
    expect(decodeObjects("{ truncated json")).toBeNull();
  });

  it("rejects an envelope carrying nothing object-shaped", () => {
    expect(
      decodeObjects(JSON.stringify({ kind: "renote/objects@1", source: SOURCE, objects: [42] })),
    ).toBeNull();
  });
});

describe("paste placement", () => {
  it("gives every pasted object a fresh id without touching the originals", () => {
    const originals = [object("a", 0, 0), object("b", 10, 10)];
    const copies = withFreshIds(originals);
    expect(copies.map((copy) => copy.id)).not.toContain("a");
    expect(new Set(copies.map((copy) => copy.id)).size).toBe(2);
    expect(originals[0]?.id).toBe("a");
  });

  it("moves the group as a whole, via the transform", () => {
    const objects = [object("a", 0, 0), object("b", 100, 0)];
    translateObjects(objects, 5, -5);
    expect(objects[0]?.transform).toMatchObject({ x: 5, y: -5 });
    expect(objects[1]?.transform).toMatchObject({ x: 5, y: -5 });
    // Intrinsic bounds are left alone — only where the object sits changed.
    expect(objects[1]?.bounds.x).toBe(100);
  });

  it("centers a group on a point, keeping the objects' relative layout", () => {
    const objects = [object("a", 0, 0), object("b", 100, 0)];
    centerObjectsOn(objects, { x: 1000, y: 1000 });
    const bounds = groupBounds(objects);
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width / 2).toBeCloseTo(1000);
    expect(bounds!.y + bounds!.height / 2).toBeCloseTo(1000);
    expect(bounds!.width).toBe(200);
  });
});

describe("pasted assets", () => {
  it("collects each referenced asset once", () => {
    const objects = [
      object("a", 0, 0, { assetPath: "assets/p1/one.png" }),
      object("b", 0, 0, { assetPath: "assets/p1/one.png" }),
      object("c", 0, 0, {}),
    ];
    expect(assetPathsOf(objects)).toEqual(["assets/p1/one.png"]);
  });

  it("rewrites only the paths that were copied", () => {
    const objects = [
      object("a", 0, 0, { assetPath: "old.png" }),
      object("b", 0, 0, { assetPath: "missing.png" }),
    ];
    remapAssetPaths(objects, new Map([["old.png", "assets/p2/new.png"]]));
    expect((objects[0]?.data as { assetPath: string }).assetPath).toBe("assets/p2/new.png");
    expect((objects[1]?.data as { assetPath: string }).assetPath).toBe("missing.png");
  });
});

describe("plain text paste", () => {
  /** `paragraphs` is a block union (paragraph | code block | table); plain text only ever
   *  produces paragraphs, so narrowing here keeps the assertions readable. */
  const runsOf = (content: RichTextDocument, index: number) =>
    (content.paragraphs[index] as RichTextParagraphBlock | undefined)?.runs as RichTextTextRun[] | undefined;

  it("becomes one paragraph per line", () => {
    const content = plainTextContent("first\nsecond");
    expect(content.paragraphs).toHaveLength(2);
    expect(runsOf(content, 0)?.[0]?.text).toBe("first");
    expect(runsOf(content, 1)?.[0]?.text).toBe("second");
  });

  it("keeps a blank line as an empty paragraph", () => {
    expect(runsOf(plainTextContent("a\n\nb"), 1)).toEqual([]);
  });
});
