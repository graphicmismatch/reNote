import { InkSettingsRegistry, NullRenderer, PageEngine, registerBuiltInTools } from "@renote/canvas-engine";
import { describe, expect, it } from "vitest";
import { applyAutoInkColorForBackground, isDarkColor } from "./auto-ink-switch.js";

describe("isDarkColor", () => {
  it("treats white as light", () => {
    expect(isDarkColor("#ffffff")).toBe(false);
  });

  it("treats black as dark", () => {
    expect(isDarkColor("#000000")).toBe(true);
  });

  it("treats a dark navy as dark", () => {
    expect(isDarkColor("#0b1d33")).toBe(true);
  });

  it("treats a pale cream as light", () => {
    expect(isDarkColor("#fdf6e3")).toBe(false);
  });

  it("handles a shorthand #rgb form", () => {
    expect(isDarkColor("#000")).toBe(true);
    expect(isDarkColor("#fff")).toBe(false);
  });

  it("treats a malformed color as light rather than throwing", () => {
    expect(() => isDarkColor("not-a-color")).not.toThrow();
    expect(isDarkColor("not-a-color")).toBe(false);
  });
});

function buildEngine(): PageEngine {
  const engine = new PageEngine(new NullRenderer(), new InkSettingsRegistry());
  registerBuiltInTools(engine);
  return engine;
}

describe("applyAutoInkColorForBackground", () => {
  it("sets black/white-defaulted tools to white on a dark paper color", () => {
    const engine = buildEngine();
    applyAutoInkColorForBackground(engine, { color: "#000000", ruleLines: "none" });

    expect(engine.inkSettings.get("pen")?.color).toBe("#ffffff");
    expect(engine.inkSettings.get("shape-rectangle")?.color).toBe("#ffffff");
    expect(engine.inkSettings.get("shape-ellipse")?.color).toBe("#ffffff");
    expect(engine.inkSettings.get("shape-line")?.color).toBe("#ffffff");
    expect(engine.inkSettings.get("shape-arrow")?.color).toBe("#ffffff");
  });

  it("sets black/white-defaulted tools to black on a light/default paper color", () => {
    const engine = buildEngine();
    // First flip to white (dark paper)...
    applyAutoInkColorForBackground(engine, { color: "#000000", ruleLines: "none" });
    // ...then back to a null (default, light) paper color.
    applyAutoInkColorForBackground(engine, { color: null, ruleLines: "none" });

    expect(engine.inkSettings.get("pen")?.color).toBe("#000000");
  });

  it("never touches the highlighter's default color", () => {
    const engine = buildEngine();
    const before = engine.inkSettings.get("highlighter")?.color;
    applyAutoInkColorForBackground(engine, { color: "#000000", ruleLines: "none" });
    expect(engine.inkSettings.get("highlighter")?.color).toBe(before);
  });

  it("does not override a color the user already picked via setColor", () => {
    const engine = buildEngine();
    engine.inkSettings.setColor("pen", "#8b0000"); // user picks a custom color
    applyAutoInkColorForBackground(engine, { color: "#000000", ruleLines: "none" });
    expect(engine.inkSettings.get("pen")?.color).toBe("#8b0000");
  });
});
