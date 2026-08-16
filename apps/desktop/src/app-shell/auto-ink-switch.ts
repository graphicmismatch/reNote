import { resolvePaperColor, type PageEngine } from "@renote/canvas-engine";
import type { PageBackground } from "@renote/core";

/**
 * Tool ids whose default ink color is plain black/white (never a saturated hue), and therefore
 * eligible for the auto light/dark paper-color switch (see `applyAutoInkColorForBackground`
 * below). Mirrors `AppShell.tsx`'s own `TOOL_SETTINGS_CONFIG`/`SHAPE_TOOL_IDS` — pen plus the
 * four shape tools. Deliberately excludes "highlighter" (default yellow) and both erasers (no
 * color concept at all) — see `ink-settings.ts`'s doc comment on why erasers carry no color.
 */
const AUTO_INK_SWITCH_TOOL_IDS = ["pen", "shape-rectangle", "shape-ellipse", "shape-line", "shape-arrow"];

/**
 * Perceived-luminance threshold (ITU-R BT.601 luma weights), the same formula this project's
 * plan calls for. `hexColor` must be a `#rgb` or `#rrggbb` string; anything else is treated as
 * light (not dark) rather than throwing, since a malformed color should never crash ink-switch
 * logic that runs on every page load/background change.
 */
export function isDarkColor(hexColor: string): boolean {
  const hex = hexColor.startsWith("#") ? hexColor.slice(1) : hexColor;
  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (normalized.length !== 6) return false;

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) return false;

  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance < 128;
}

/**
 * Confirmed-scope auto black/white ink-switch (Phase 5.10): flips each black/white-defaulted
 * tool's *default* color between black and white based on the *page's own* paper color, never
 * the app chrome theme (see `page-background.ts`'s `resolvePaperColor` doc comment on why paper
 * color is theme-independent). Only ever writes via `InkSettingsRegistry.setDefaultColor`, which
 * silently no-ops once the user has picked a custom color for a tool (see that method's doc
 * comment) — so this is always safe to call again on every background change without ever
 * fighting a color the user chose themselves, and it never touches already-drawn strokes.
 *
 * Called from two places that must stay in sync (hence this one shared helper): `PageEditorView`'s
 * page-load effect (the automatic-on-load path) and `AppShell`'s background-panel change handler
 * (the immediate-feedback-on-edit path).
 */
export function applyAutoInkColorForBackground(engine: PageEngine, background: PageBackground): void {
  const paperColor = resolvePaperColor(background.color);
  const inkColor = isDarkColor(paperColor) ? "#ffffff" : "#000000";
  for (const toolId of AUTO_INK_SWITCH_TOOL_IDS) {
    engine.inkSettings.setDefaultColor(toolId, inkColor);
  }
}
