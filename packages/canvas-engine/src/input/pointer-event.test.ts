import { describe, expect, it } from "vitest";
import { normalizedSourceOf } from "./pointer-event.js";

describe("normalizedSourceOf", () => {
  it("classifies pointerType directly when no override applies", () => {
    expect(normalizedSourceOf("pen")).toBe("pen");
    expect(normalizedSourceOf("touch")).toBe("touch");
    expect(normalizedSourceOf("mouse")).toBe("mouse");
    // Anything unrecognized falls back to mouse, matching a plain PointerEvent's own default.
    expect(normalizedSourceOf("unknown")).toBe("mouse");
  });

  it("applies a matching override", () => {
    expect(normalizedSourceOf("touch", { touch: "pen" })).toBe("pen");
    expect(normalizedSourceOf("mouse", { mouse: "pen" })).toBe("pen");
  });

  it("leaves sources with no configured override unaffected", () => {
    // Only "touch" is overridden; "pen" input should classify normally.
    expect(normalizedSourceOf("pen", { touch: "pen" })).toBe("pen");
    expect(normalizedSourceOf("mouse", { touch: "pen" })).toBe("mouse");
  });

  it("an empty overrides object is equivalent to no overrides", () => {
    expect(normalizedSourceOf("touch", {})).toBe("touch");
  });
});
