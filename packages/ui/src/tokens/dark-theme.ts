import type { ChromeTokens } from "./chrome-tokens.js";

const PIXEL_FONT_STACK = '"Renote Pixel", "Silkscreen", monospace';

/**
 * Authored independently from lightChromeTokens rather than derived from it
 * via a runtime `filter: invert()` — see the project plan's note that dark
 * mode gets its own hand-drawn dither/pinstripe patterns, not an inverted
 * copy of the light theme.
 */
export const darkChromeTokens: ChromeTokens = {
  colorBackground: "#000000",
  colorForeground: "#ffffff",
  colorForegroundMuted: "#8a8a8a",
  colorBorder: "#ffffff",
  borderWidthPx: 1,
  fontFamily: PIXEL_FONT_STACK,
  fontSizeStepsPx: [8, 10, 12, 16, 20, 24],
  ditherPatternImage: "repeating-conic-gradient(#ffffff 0% 25%, #000000 0% 50%) 0 0 / 2px 2px",
  pinstripePatternImage:
    "repeating-linear-gradient(0deg, #ffffff 0px, #ffffff 1px, #000000 1px, #000000 3px)",
  scrollbarThicknessPx: 16,
  checkboxUncheckedGlyph: "☐",
  checkboxCheckedGlyph: "☒",
  radioUncheckedGlyph: "◯",
  radioCheckedGlyph: "◉",
  disclosureCollapsedGlyph: "▷",
  disclosureExpandedGlyph: "▽",
};
