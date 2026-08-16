import type { ChromeTokens } from "./chrome-tokens.js";

/**
 * Converts a ChromeTokens object into CSS custom properties. Components
 * consume `var(--renote-*)` rather than importing token values directly, so
 * a future third theme needs only a new ChromeTokens object here — zero
 * component changes.
 */
export function chromeTokensToCssVariables(tokens: ChromeTokens): Record<string, string> {
  return {
    "--renote-color-background": tokens.colorBackground,
    "--renote-color-foreground": tokens.colorForeground,
    "--renote-color-foreground-muted": tokens.colorForegroundMuted,
    "--renote-color-border": tokens.colorBorder,
    "--renote-border-width": `${tokens.borderWidthPx}px`,
    "--renote-font-family": tokens.fontFamily,
    "--renote-font-size-xs": `${tokens.fontSizeStepsPx[0]}px`,
    "--renote-font-size-sm": `${tokens.fontSizeStepsPx[1]}px`,
    "--renote-font-size-md": `${tokens.fontSizeStepsPx[2]}px`,
    "--renote-font-size-lg": `${tokens.fontSizeStepsPx[3]}px`,
    "--renote-font-size-xl": `${tokens.fontSizeStepsPx[4]}px`,
    "--renote-font-size-xxl": `${tokens.fontSizeStepsPx[5]}px`,
    "--renote-dither-pattern": tokens.ditherPatternImage,
    "--renote-pinstripe-pattern": tokens.pinstripePatternImage,
    "--renote-scrollbar-thickness": `${tokens.scrollbarThicknessPx}px`,
  };
}
