import { useEffect, useId, type ChangeEvent } from "react";
import "./PageBackgroundPanel.css";

/**
 * Local to this package on purpose — `packages/ui` must never import `@renote/core` (which owns
 * the real `PageRuleLines`/`PageBackground` types) or `@renote/canvas-engine` — mirrors
 * `SettingsDialog.tsx`'s own `PointerSourceOption` for the same reason. The string literal union
 * below is kept in sync with `packages/core/src/model/page.ts`'s `PageRuleLines` by convention,
 * not by import.
 */
export type PageRuleLinesOption = "none" | "college-ruled" | "wide-ruled" | "graph" | "dotted";

export interface PageBackgroundValue {
  /** `null` means "use the app's default paper color" — see the "Default" button below. */
  color: string | null;
  ruleLines: PageRuleLinesOption;
}

export interface PageBackgroundPanelProps {
  open: boolean;
  onClose: () => void;
  background: PageBackgroundValue;
  onChange: (background: PageBackgroundValue) => void;
}

/** A small set of common paper colors, alongside a custom-color input and a "Default" button
 *  that clears back to `null` — mirroring `ToolSettingsPanel.tsx`'s own preset-swatch-row
 *  convention for ink colors. */
const PRESET_PAPER_COLORS = ["#ffffff", "#fdf6e3", "#1e1e1e", "#0b1d33", "#f5e6d3"];

const RULE_LINE_OPTIONS: ReadonlyArray<{ value: PageRuleLinesOption; label: string }> = [
  { value: "none", label: "None" },
  { value: "college-ruled", label: "College Ruled" },
  { value: "wide-ruled", label: "Wide Ruled" },
  { value: "graph", label: "Graph" },
  { value: "dotted", label: "Dotted" },
];

/** Fallback swatch shown for the "custom color" input when the page currently has no explicit
 *  color (`null`, i.e. "use default") — a plain `<input type="color">` can't itself render
 *  `null`, so it shows white as a neutral starting point for picking a new custom color. */
const NO_COLOR_SWATCH_FALLBACK = "#ffffff";

/**
 * Per-page background editor: paper color + rule-line style. Styled like `SettingsDialog.tsx`
 * (a centered modal panel, Escape-to-close via a window listener) since this is an occasional
 * per-page action opened from the command palette, not persistent sidebar chrome. Presentational
 * only — the caller owns persisting the change and applying it to the live canvas for immediate
 * feedback; this component only reports intent via `onChange`.
 */
export function PageBackgroundPanel({
  open,
  onClose,
  background,
  onChange,
}: PageBackgroundPanelProps): JSX.Element | null {
  // Mirrors SettingsDialog's Escape-to-close.
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const idPrefix = useId();

  if (!open) {
    return null;
  }

  const handlePresetClick = (color: string) => {
    onChange({ ...background, color });
  };

  const handleCustomColorChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...background, color: event.target.value });
  };

  const handleUseDefault = () => {
    onChange({ ...background, color: null });
  };

  const handleRuleLinesChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...background, ruleLines: event.target.value as PageRuleLinesOption });
  };

  const colorRowId = `${idPrefix}-color`;
  const ruleLinesId = `${idPrefix}-rule-lines`;
  const isPresetColor = background.color !== null && PRESET_PAPER_COLORS.includes(background.color);

  return (
    <div className="renote-page-background-panel-backdrop" onClick={onClose}>
      <div
        className="renote-page-background-panel-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Page Background"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="renote-page-background-panel-title">Page Background</div>
        <section className="renote-page-background-panel-section">
          <span className="renote-page-background-panel-section-title">Paper Color</span>
          <div className="renote-page-background-panel-row" id={colorRowId}>
            <div className="renote-page-background-panel-swatch-row">
              {PRESET_PAPER_COLORS.map((preset) => {
                const selected = background.color === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-label={`Set paper color to ${preset}`}
                    aria-pressed={selected}
                    className={
                      selected
                        ? "renote-page-background-panel-swatch renote-page-background-panel-swatch-selected"
                        : "renote-page-background-panel-swatch"
                    }
                    style={{ backgroundColor: preset }}
                    onClick={() => handlePresetClick(preset)}
                  />
                );
              })}
              <input
                type="color"
                aria-label="Custom paper color"
                className={
                  isPresetColor
                    ? "renote-page-background-panel-custom-color"
                    : "renote-page-background-panel-custom-color renote-page-background-panel-swatch-selected"
                }
                value={background.color ?? NO_COLOR_SWATCH_FALLBACK}
                onChange={handleCustomColorChange}
              />
              <button
                type="button"
                className="renote-page-background-panel-default-button"
                aria-pressed={background.color === null}
                onClick={handleUseDefault}
              >
                Default
              </button>
            </div>
          </div>
        </section>
        <section className="renote-page-background-panel-section">
          <span className="renote-page-background-panel-section-title">Rule Lines</span>
          <div className="renote-page-background-panel-row">
            <label className="renote-page-background-panel-row-label" htmlFor={ruleLinesId}>
              Style
            </label>
            <select
              id={ruleLinesId}
              className="renote-page-background-panel-select"
              value={background.ruleLines}
              onChange={handleRuleLinesChange}
            >
              {RULE_LINE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </section>
      </div>
    </div>
  );
}
