import { PixelButton } from "../primitives/PixelButton.js";
import "./ThemeToggle.css";

export interface ThemeToggleProps {
  mode: "light" | "dark";
  onToggle: () => void;
}

/**
 * A small labeled control that flips light/dark. Stays prop-driven — it does
 * not call `useTheme()` itself, so the caller controls when the mode
 * actually changes.
 */
export function ThemeToggle({ mode, onToggle }: ThemeToggleProps) {
  return (
    <PixelButton
      type="button"
      role="switch"
      aria-checked={mode === "dark"}
      className="renote-theme-toggle"
      onClick={onToggle}
    >
      {mode === "dark" ? "Dark" : "Light"}
    </PixelButton>
  );
}
