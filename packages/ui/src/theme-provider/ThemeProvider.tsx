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
  }, [tokens]);

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
