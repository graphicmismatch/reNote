import type { ChromeTokens } from "./chrome-tokens.js";

const PIXEL_FONT_STACK = '"Renote Pixel", "Silkscreen", monospace';

export const lightChromeTokens: ChromeTokens = {
  colorBackground: "#ffffff",
  colorForeground: "#000000",
  colorForegroundMuted: "#767676",
  colorBorder: "#000000",
  borderWidthPx: 1,
  fontFamily: PIXEL_FONT_STACK,
  fontSizeStepsPx: [8, 10, 12, 16, 20, 24],
  ditherPatternImage: "repeating-conic-gradient(#000000 0% 25%, #ffffff 0% 50%) 0 0 / 2px 2px",
  pinstripePatternImage:
    "repeating-linear-gradient(0deg, #000000 0px, #000000 1px, #ffffff 1px, #ffffff 3px)",
  scrollbarThicknessPx: 16,
  checkboxUncheckedGlyph: "☐",
  checkboxCheckedGlyph: "☒",
  radioUncheckedGlyph: "◯",
  radioCheckedGlyph: "◉",
  disclosureCollapsedGlyph: "▶",
  disclosureExpandedGlyph: "▼",
};
