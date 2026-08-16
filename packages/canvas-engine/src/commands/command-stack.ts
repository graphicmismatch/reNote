import { EventBus, type EditableCommand } from "@renote/core";

export interface CommandStackOptions {
  /** Oldest entries beyond this cap are dropped, since retained ink-heavy commands can be large. */
  maxHistoryEntries?: number;
}

export interface CommandStackSnapshot<TState> {
  entries: readonly EditableCommand<TState>[];
  pointer: number;
}

export interface CommandStackEvents<TState> extends Record<string, unknown> {
  changed: CommandStackSnapshot<TState>;
}

const DEFAULT_MAX_HISTORY_ENTRIES = 200;

/**
 * Paint.NET-style linear command history: not a bare undo/redo stack, but a
 * pointer into an ordered command log that a History panel can render and
 * jump to any entry of directly. Starting a new command after jumping back
 * truncates the redo tail, same as clicking an old entry in Paint.NET's
 * history list and then drawing something new.
 */
export class CommandStack<TState = unknown> {
  readonly events = new EventBus<CommandStackEvents<TState>>();
  private entries: EditableCommand<TState>[] = [];
  /** Index of the last applied command; -1 means nothing has been applied. */
  private pointer = -1;
  private readonly maxHistoryEntries: number;

  constructor(
    private readonly state: TState,
    options: CommandStackOptions = {},
  ) {
    this.maxHistoryEntries = options.maxHistoryEntries ?? DEFAULT_MAX_HISTORY_ENTRIES;
  }

  execute(command: EditableCommand<TState>): void {
    this.entries = this.entries.slice(0, this.pointer + 1);
    command.do(this.state);
    this.entries.push(command);
    this.pointer = this.entries.length - 1;
    this.enforceCap();
    this.emitChanged();
  }

  undo(): void {
    if (!this.canUndo) return;
    this.entries[this.pointer]!.undo(this.state);
    this.pointer -= 1;
    this.emitChanged();
  }

  redo(): void {
    if (!this.canRedo) return;
    this.pointer += 1;
    this.entries[this.pointer]!.do(this.state);
    this.emitChanged();
  }

  /**
   * Jumps directly to the state immediately after `history[index]` was applied.
   * index === -1 means "before the first command." This is what the History
   * panel calls when the user clicks an arbitrary past entry.
   */
  jumpTo(index: number): void {
    if (index < -1 || index >= this.entries.length) {
      throw new RangeError(`History index ${index} is out of range.`);
    }
    while (this.pointer > index) {
      this.entries[this.pointer]!.undo(this.state);
      this.pointer -= 1;
    }
    while (this.pointer < index) {
      this.pointer += 1;
      this.entries[this.pointer]!.do(this.state);
    }
    this.emitChanged();
  }

  private enforceCap(): void {
    if (this.entries.length <= this.maxHistoryEntries) return;
    const excess = this.entries.length - this.maxHistoryEntries;
    this.entries.splice(0, excess);
    this.pointer -= excess;
  }

  get canUndo(): boolean {
    return this.pointer >= 0;
  }

  get canRedo(): boolean {
    return this.pointer < this.entries.length - 1;
  }

  get history(): readonly EditableCommand<TState>[] {
    return this.entries;
  }

  get pointerIndex(): number {
    return this.pointer;
  }

  private emitChanged(): void {
    this.events.emit("changed", { entries: this.entries, pointer: this.pointer });
  }
}
