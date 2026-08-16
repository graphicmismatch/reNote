import type { ButtonHTMLAttributes } from "react";
import "./PixelButton.css";

export type PixelButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Reference primitive proving the token architecture: every visual value
 * comes from `var(--renote-*)` custom properties emitted by ThemeProvider,
 * so this component never changes when a theme (or a future third theme)
 * changes.
 */
export function PixelButton({ className, children, ...rest }: PixelButtonProps) {
  return (
    <button className={["renote-pixel-button", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </button>
  );
}
