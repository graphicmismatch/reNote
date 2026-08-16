import { describe, expect, it, vi } from "vitest";
import { InkSettingsRegistry } from "./ink-settings.js";

describe("InkSettingsRegistry", () => {
  it("returns undefined for an unregistered tool id", () => {
    const registry = new InkSettingsRegistry();
    expect(registry.get("pen")).toBeUndefined();
  });

  it("register seeds a tool's starting values", () => {
    const registry = new InkSettingsRegistry();
    registry.register("pen", { color: "#000000", width: 2 });
    expect(registry.get("pen")).toEqual({ color: "#000000", width: 2 });
  });

  it("register is a no-op once a tool id already has an entry, so it never clobbers a live value", () => {
    const registry = new InkSettingsRegistry();
    registry.register("pen", { color: "#000000", width: 2 });
    registry.setColor("pen", "#ff0000");
    registry.register("pen", { color: "#000000", width: 2 });
    expect(registry.get("pen")).toEqual({ color: "#ff0000", width: 2 });
  });

  it("setColor/setWidth update only the given tool id, leaving others untouched", () => {
    const registry = new InkSettingsRegistry();
    registry.register("pen", { color: "#000000", width: 2 });
    registry.register("highlighter", { color: "#ffe066", width: 14 });

    registry.setColor("pen", "#0000ff");
    registry.setWidth("pen", 5);

    expect(registry.get("pen")).toEqual({ color: "#0000ff", width: 5 });
    expect(registry.get("highlighter")).toEqual({ color: "#ffe066", width: 14 });
  });

  it("setColor/setWidth on an unregistered tool id is a no-op, not a throw", () => {
    const registry = new InkSettingsRegistry();
    expect(() => registry.setColor("ghost", "#123456")).not.toThrow();
    expect(registry.get("ghost")).toBeUndefined();
  });

  it("emits 'changed' with the tool id and the full updated settings", () => {
    const registry = new InkSettingsRegistry();
    registry.register("pen", { color: "#000000", width: 2 });
    const listener = vi.fn();
    registry.events.on("changed", listener);

    registry.setColor("pen", "#00ff00");

    expect(listener).toHaveBeenCalledWith({ toolId: "pen", settings: { color: "#00ff00", width: 2 } });
  });

  describe("setDefaultColor (auto black/white ink-switch)", () => {
    it("writes the color while the tool is still at its seeded default", () => {
      const registry = new InkSettingsRegistry();
      registry.register("pen", { color: "#000000", width: 2 });

      registry.setDefaultColor("pen", "#ffffff");

      expect(registry.get("pen")).toEqual({ color: "#ffffff", width: 2 });
    });

    it("is a silent no-op once setColor has been called for that tool id", () => {
      const registry = new InkSettingsRegistry();
      registry.register("pen", { color: "#000000", width: 2 });

      registry.setColor("pen", "#8b0000"); // user picks a custom color
      registry.setDefaultColor("pen", "#ffffff"); // auto-switch tries to override it

      expect(registry.get("pen")).toEqual({ color: "#8b0000", width: 2 });
    });

    it("stays permanently blocked even across re-registration of the same tool id", () => {
      const registry = new InkSettingsRegistry();
      registry.register("pen", { color: "#000000", width: 2 });
      registry.setColor("pen", "#8b0000");

      // register() is called on every PageEngine mount (see its doc comment) — it must not
      // reset the "user customized this" flag back to "still default".
      registry.register("pen", { color: "#000000", width: 2 });
      registry.setDefaultColor("pen", "#ffffff");

      expect(registry.get("pen")).toEqual({ color: "#8b0000", width: 2 });
    });

    it("is a no-op (not a throw) on an unregistered tool id", () => {
      const registry = new InkSettingsRegistry();
      expect(() => registry.setDefaultColor("ghost", "#ffffff")).not.toThrow();
      expect(registry.get("ghost")).toBeUndefined();
    });

    it("emits 'changed' when it successfully writes", () => {
      const registry = new InkSettingsRegistry();
      registry.register("pen", { color: "#000000", width: 2 });
      const listener = vi.fn();
      registry.events.on("changed", listener);

      registry.setDefaultColor("pen", "#ffffff");

      expect(listener).toHaveBeenCalledWith({ toolId: "pen", settings: { color: "#ffffff", width: 2 } });
    });

    it("does not emit 'changed' when blocked by a prior setColor", () => {
      const registry = new InkSettingsRegistry();
      registry.register("pen", { color: "#000000", width: 2 });
      registry.setColor("pen", "#8b0000");
      const listener = vi.fn();
      registry.events.on("changed", listener);

      registry.setDefaultColor("pen", "#ffffff");

      expect(listener).not.toHaveBeenCalled();
    });

    it("tracks each tool id independently", () => {
      const registry = new InkSettingsRegistry();
      registry.register("pen", { color: "#000000", width: 2 });
      registry.register("shape-rectangle", { color: "#000000", width: 2 });
      registry.setColor("pen", "#8b0000");

      registry.setDefaultColor("pen", "#ffffff");
      registry.setDefaultColor("shape-rectangle", "#ffffff");

      expect(registry.get("pen")).toEqual({ color: "#8b0000", width: 2 });
      expect(registry.get("shape-rectangle")).toEqual({ color: "#ffffff", width: 2 });
    });
  });
});
