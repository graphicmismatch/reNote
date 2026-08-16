import type { AppCommand } from "@renote/core";

export type RebindResult = { ok: true } | { ok: false; conflictsWith: string };

/**
 * Reads the same AppCommand list the command palette reads, so keybindings
 * and the palette stay one subsystem instantiated two ways rather than two
 * separately maintained features.
 */
export class KeymapRegistry {
  private readonly commandsById = new Map<string, AppCommand>();
  private readonly commandIdByCombo = new Map<string, string>();

  constructor(commands: readonly AppCommand[]) {
    for (const command of commands) {
      this.commandsById.set(command.id, command);
      if (command.defaultShortcut) {
        this.commandIdByCombo.set(command.defaultShortcut, command.id);
      }
    }
  }

  rebind(commandId: string, combo: string): RebindResult {
    if (!this.commandsById.has(commandId)) {
      throw new Error(`Unknown command "${commandId}".`);
    }
    const existingOwner = this.commandIdByCombo.get(combo);
    if (existingOwner && existingOwner !== commandId) {
      return { ok: false, conflictsWith: existingOwner };
    }
    for (const [existingCombo, ownerId] of this.commandIdByCombo) {
      if (ownerId === commandId) this.commandIdByCombo.delete(existingCombo);
    }
    this.commandIdByCombo.set(combo, commandId);
    return { ok: true };
  }

  resolve(combo: string): AppCommand | undefined {
    const id = this.commandIdByCombo.get(combo);
    return id ? this.commandsById.get(id) : undefined;
  }

  /** Looks the combo up and invokes the bound command's handler if one exists. Returns whether it handled it. */
  handleCombo(combo: string): boolean {
    const command = this.resolve(combo);
    if (!command) return false;
    void command.handler();
    return true;
  }
}
