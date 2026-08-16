import type { EditableCommand } from "@renote/core";

/**
 * Groups an ordered list of sub-commands into a single undo/redo entry. `do` runs the
 * sub-commands in order (index 0 first); `undo` runs their inverses in REVERSE order (last
 * sub-command's undo first), mirroring how a stack of dependent edits must be unwound —
 * e.g. if sub-command B's `do` assumed A had already run, B's `undo` must run before A's.
 *
 * This is what lets a single continuous gesture (a stroke-eraser drag touching three strokes,
 * a pixel-eraser drag that removes one stroke and splits another into two) collapse into one
 * `CommandStack` history entry instead of one entry per underlying mutation.
 */
export class CompositeCommand<TState = unknown> implements EditableCommand<TState> {
  readonly id: string;
  readonly label: string;
  readonly kind: string;

  constructor(private readonly subCommands: readonly EditableCommand<TState>[]) {
    if (subCommands.length === 0) {
      throw new Error("CompositeCommand requires at least one sub-command.");
    }
    this.id = `composite-${subCommands.map((c) => c.id).join("+")}`;
    this.label = `${subCommands.length} changes`;
    this.kind = subCommands[0]!.kind;
  }

  do(state: TState): void {
    for (const command of this.subCommands) {
      command.do(state);
    }
  }

  undo(state: TState): void {
    for (let i = this.subCommands.length - 1; i >= 0; i -= 1) {
      this.subCommands[i]!.undo(state);
    }
  }
}
