/**
 * A single reversible edit to a page's object model (add/move/resize/delete/text-edit/etc).
 * Every mutation in the canvas engine goes through a command — never in-place unlogged
 * mutation — so the same log can drive undo/redo, the Paint.NET-style history panel, and
 * local version snapshots without a second representation.
 */
export interface EditableCommand<TState = unknown> {
  readonly id: string;
  readonly label: string;
  /** Icon/type hint for the history panel; typically the affected object's type. */
  readonly kind: string;
  do(state: TState): void;
  undo(state: TState): void;
}
