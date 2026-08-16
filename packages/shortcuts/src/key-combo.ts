interface KeyboardEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Normalizes a key event into a cross-platform combo string. "Mod" stands in
 * for Ctrl on Windows/Linux and Cmd on macOS, so a single default-shortcut
 * value in an AppCommand works correctly on all three target platforms.
 */
export function keyboardEventToCombo(event: KeyboardEventLike): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return parts.join("+");
}
