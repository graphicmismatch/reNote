import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import "../tokens/interaction-tokens.css";
import { chromeTokensToCssVariables } from "../tokens/css-variables.js";
import { darkChromeTokens } from "../tokens/dark-theme.js";
import { lightChromeTokens } from "../tokens/light-theme.js";
import type { ChromeTokens } from "../tokens/chrome-tokens.js";

export type ThemeMode = "light" | "dark";

interface ThemeContextValue {
  mode: ThemeMode;
  tokens: ChromeTokens;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
  defaultMode?: ThemeMode;
}

export function ThemeProvider({ children, defaultMode = "light" }: ThemeProviderProps) {
  const [mode, setMode] = useState<ThemeMode>(defaultMode);
  const tokens = mode === "light" ? lightChromeTokens : darkChromeTokens;

  useEffect(() => {
    const cssVariables = chromeTokensToCssVariables(tokens);
    for (const [name, value] of Object.entries(cssVariables)) {
      document.documentElement.style.setProperty(name, value);
    }
    // Without this, the browser still assumes a light UI for anything it paints itself —
    // <select>/<input type="number"> chrome, the checkbox tick, scrollbars — and renders that
    // native chrome with its light palette even though our own CSS sets a dark background/text
    // on top, which is what made dropdown text unreadable in dark mode (low contrast between our
    // dark text-on-dark-background CSS and the mismatched light native widget underneath).
    document.documentElement.style.colorScheme = mode;
  }, [tokens, mode]);

  const value = useMemo<ThemeContextValue>(() => ({ mode, tokens, setMode }), [mode, tokens]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }
  return context;
}
