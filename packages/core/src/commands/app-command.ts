/**
 * A user-invokable app action (insert table, toggle bold, undo, open command palette, new page).
 * The command palette and the customizable-keybinding UI both read the same registry of these,
 * so they stay one subsystem instantiated two ways rather than two features maintained separately.
 */
export interface AppCommand {
  readonly id: string;
  readonly label: string;
  readonly defaultShortcut: string | null;
  handler(): void | Promise<void>;
}
