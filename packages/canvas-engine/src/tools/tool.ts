import type { NormalizedPointerEvent } from "../input/pointer-event.js";

/**
 * A pluggable tool state machine (pen, highlighter, eraser, lasso, text, shape, select).
 * The engine swaps the active tool rather than branching on which one is active, so
 * adding a new tool never touches input-dispatch code.
 */
export interface Tool {
  readonly id: string;
  readonly cursor: string;
  onPointerDown(event: NormalizedPointerEvent): void;
  onPointerMove(event: NormalizedPointerEvent): void;
  onPointerUp(event: NormalizedPointerEvent): void;
  /** Called on Escape or when the tool is deactivated mid-gesture. */
  onCancel(): void;
}
