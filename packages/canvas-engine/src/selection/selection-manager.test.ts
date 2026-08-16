import { describe, expect, it } from "vitest";
import type { PageObjectId } from "@renote/core";
import { SelectionManager } from "./selection-manager.js";

const a = "a" as PageObjectId;
const b = "b" as PageObjectId;

describe("SelectionManager", () => {
  it("toggle adds an unselected id and removes an already-selected one", () => {
    const selection = new SelectionManager();
    selection.toggle(a);
    expect(selection.selectedIds).toEqual([a]);
    selection.toggle(b);
    expect(selection.selectedIds).toEqual([a, b]);
    selection.toggle(a);
    expect(selection.selectedIds).toEqual([b]);
  });

  it("remove is a no-op (no event) when the id isn't selected", () => {
    const selection = new SelectionManager();
    let changes = 0;
    selection.events.on("changed", () => (changes += 1));
    selection.remove(a);
    expect(changes).toBe(0);
    expect(selection.selectedIds).toEqual([]);
  });
});
