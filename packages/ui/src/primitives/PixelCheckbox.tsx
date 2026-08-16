import { useTheme } from "../theme-provider/ThemeProvider.js";
import "./PixelCheckbox.css";

export interface PixelCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

/** Renders the theme's checkbox glyphs directly rather than a native checkbox input, to keep the bitmap look. */
export function PixelCheckbox({ checked, onChange, label }: PixelCheckboxProps) {
  const { tokens } = useTheme();

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className="renote-pixel-checkbox"
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true">{checked ? tokens.checkboxCheckedGlyph : tokens.checkboxUncheckedGlyph}</span>
      {label ? <span>{label}</span> : null}
    </button>
  );
}
