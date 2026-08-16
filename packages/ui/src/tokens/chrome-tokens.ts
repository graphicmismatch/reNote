/**
 * Chrome tokens are the ONLY thing a theme swaps. They describe the System 1
 * black-and-white pixel look — borders, patterns, fonts, control glyphs.
 *
 * Content colors (ink pen color, highlighter color, tag/section color) do
 * NOT belong here — those live on the document/domain model in
 * `@renote/core` and must render identically regardless of which chrome
 * theme is active. See the project plan's design-system section.
 */
export interface ChromeTokens {
  colorBackground: string;
  colorForeground: string;
  /**
   * Text color for disabled controls. Disabled `PixelButton`s render their
   * background as `ditherPatternImage` (a checkerboard alternating between
   * `colorBackground` and `colorForeground`); using `colorForeground` for the
   * text itself would exactly match half of those squares and disappear. A
   * flat mid-tone that matches neither square stays legible against both.
   */
  colorForegroundMuted: string;
  colorBorder: string;
  borderWidthPx: number;
  /** Pixel font family stack; falls back gracefully if the bitmap font isn't loaded yet. */
  fontFamily: string;
  /**
   * Font sizes are constrained to integer pixel steps so the bitmap font
   * stays crisp under fractional OS display scaling (125%/150%) on both
   * Wayland's native scaling and X11's Xft.dpi path — see the plan's
   * cross-platform risk notes.
   */
  fontSizeStepsPx: readonly number[];
  /** CSS `background-image` value for a 1-bit dithered fill, used instead of gradients. */
  ditherPatternImage: string;
  /** CSS `background-image` value for a pinstripe title-bar fill. */
  pinstripePatternImage: string;
  scrollbarThicknessPx: number;
  checkboxUncheckedGlyph: string;
  checkboxCheckedGlyph: string;
  radioUncheckedGlyph: string;
  radioCheckedGlyph: string;
  disclosureCollapsedGlyph: string;
  disclosureExpandedGlyph: string;
}
