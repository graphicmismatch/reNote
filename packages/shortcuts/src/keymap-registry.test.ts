import { describe, expect, it, vi } from "vitest";
import { KeymapRegistry } from "./keymap-registry.js";

function makeCommands() {
  return [
    { id: "bold", label: "Toggle Bold", defaultShortcut: "Mod+B", handler: vi.fn() },
    { id: "italic", label: "Toggle Italic", defaultShortcut: "Mod+I", handler: vi.fn() },
  ];
}

describe("KeymapRegistry", () => {
  it("resolves a combo to its default-bound command", () => {
    const commands = makeCommands();
    const keymap = new KeymapRegistry(commands);

    expect(keymap.resolve("Mod+B")?.id).toBe("bold");
  });

  it("invokes the handler when handling a bound combo", () => {
    const commands = makeCommands();
    const keymap = new KeymapRegistry(commands);

    const handled = keymap.handleCombo("Mod+I");

    expect(handled).toBe(true);
    expect(commands[1]!.handler).toHaveBeenCalled();
  });

  it("returns false for an unbound combo without throwing", () => {
    const keymap = new KeymapRegistry(makeCommands());
    expect(keymap.handleCombo("Mod+Shift+X")).toBe(false);
  });

  it("reports a conflict instead of silently overwriting an existing binding", () => {
    const keymap = new KeymapRegistry(makeCommands());

    const result = keymap.rebind("italic", "Mod+B");

    expect(result).toEqual({ ok: false, conflictsWith: "bold" });
    expect(keymap.resolve("Mod+B")?.id).toBe("bold");
  });

  it("allows rebinding a command to a free combo and clears its old binding", () => {
    const keymap = new KeymapRegistry(makeCommands());

    const result = keymap.rebind("bold", "Mod+Shift+B");

    expect(result).toEqual({ ok: true });
    expect(keymap.resolve("Mod+Shift+B")?.id).toBe("bold");
    expect(keymap.resolve("Mod+B")).toBeUndefined();
  });
});
