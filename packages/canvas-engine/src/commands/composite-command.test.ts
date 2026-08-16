import { describe, expect, it } from "vitest";
import type { EditableCommand } from "@renote/core";
import { CompositeCommand } from "./composite-command.js";

/** Records do/undo calls in `log` so ordering can be asserted directly. */
function recordingCommand(name: string, log: string[]): EditableCommand<string[]> {
  return {
    id: name,
    label: name,
    kind: "test",
    do: () => log.push(`do:${name}`),
    undo: () => log.push(`undo:${name}`),
  };
}

describe("CompositeCommand", () => {
  it("runs sub-commands forward on do, and their inverses in reverse order on undo", () => {
    const log: string[] = [];
    const composite = new CompositeCommand<string[]>([
      recordingCommand("a", log),
      recordingCommand("b", log),
      recordingCommand("c", log),
    ]);

    composite.do(log);
    expect(log).toEqual(["do:a", "do:b", "do:c"]);

    composite.undo(log);
    expect(log).toEqual(["do:a", "do:b", "do:c", "undo:c", "undo:b", "undo:a"]);
  });

  it("throws when constructed with zero sub-commands", () => {
    expect(() => new CompositeCommand([])).toThrow();
  });
});
