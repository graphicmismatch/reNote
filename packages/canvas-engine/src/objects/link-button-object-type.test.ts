import { identityTransform, type LinkButtonObject, type PageObjectId } from "@renote/core";
import { describe, expect, it } from "vitest";
import {
  LINK_BUTTON_PLACEHOLDER,
  linkButtonLabel,
  linkButtonObjectType,
  linkButtonWidthFor,
} from "./link-button-object-type.js";

function linkButton(target: LinkButtonObject["data"]["target"]): LinkButtonObject {
  return {
    id: "link-1" as PageObjectId,
    type: "link-button",
    transform: identityTransform(),
    bounds: { x: 10, y: 20, width: 180, height: 30 },
    data: { target },
  };
}

describe("linkButtonObjectType.validate", () => {
  it("accepts a button with no target yet", () => {
    expect(linkButtonObjectType.validate({ target: null })).toEqual({ target: null });
  });

  it("treats a missing target field as unset, for data written before this type existed", () => {
    expect(linkButtonObjectType.validate({})).toEqual({ target: null });
  });

  it("keeps the wikilink-shaped fields the index reads", () => {
    const target = { kind: "wikilink", attr: "page-1", attr2: "Recipes", attr3: "Setup" };
    expect(linkButtonObjectType.validate({ target })).toEqual({ target });
  });

  it("drops an empty anchor rather than storing it", () => {
    const validated = linkButtonObjectType.validate({
      target: { kind: "wikilink", attr: "page-1", attr2: "Recipes", attr3: "" },
    });
    expect(validated.target).toEqual({ kind: "wikilink", attr: "page-1", attr2: "Recipes" });
  });

  it("rejects a target with no page id", () => {
    expect(() => linkButtonObjectType.validate({ target: { kind: "wikilink", attr: "" } })).toThrow();
  });

  it("rejects a target that is not wikilink-shaped", () => {
    expect(() => linkButtonObjectType.validate({ target: { pageId: "page-1" } })).toThrow();
  });
});

describe("linkButtonLabel", () => {
  it("shows a placeholder until a target is picked", () => {
    expect(linkButtonLabel({ target: null })).toBe(LINK_BUTTON_PLACEHOLDER);
  });

  it("shows the target title", () => {
    expect(linkButtonLabel({ target: { kind: "wikilink", attr: "page-1", attr2: "Recipes" } })).toBe(
      "Recipes",
    );
  });

  it("shows the heading for an anchored link", () => {
    const label = linkButtonLabel({
      target: { kind: "wikilink", attr: "page-1", attr2: "Recipes", attr3: "Setup" },
    });
    expect(label).toBe("Recipes › Setup");
  });
});

describe("linkButtonWidthFor", () => {
  it("grows with the label but stays within bounds", () => {
    expect(linkButtonWidthFor("Hi")).toBe(140);
    expect(linkButtonWidthFor("x".repeat(200))).toBe(360);
    expect(linkButtonWidthFor("A page with a longer title")).toBeGreaterThan(140);
  });
});

describe("linkButtonObjectType.hitTest", () => {
  const object = linkButton({ kind: "wikilink", attr: "page-1", attr2: "Recipes" });

  it("hits anywhere inside the button", () => {
    expect(linkButtonObjectType.hitTest(object, { x: 100, y: 30 })).toBe(true);
  });

  it("misses outside it", () => {
    expect(linkButtonObjectType.hitTest(object, { x: 300, y: 30 })).toBe(false);
  });
});
