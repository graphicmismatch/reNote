import { useId } from "react";
import { Panel } from "./Panel.js";
import "./ToolSettingsPanel.css";

export interface ToolSettingsPanelProps {
  /** Human-readable label for the currently active tool, e.g. "Pen", "Highlighter", "Pixel Eraser". */
  toolLabel: string;
  /**
   * Current color as a hex string, or null when this tool has no color concept (the two
   * eraser tools) — the color section is omitted entirely when this is null, not rendered
   * disabled.
   */
  color: string | null;
  onColorChange: (color: string) => void;
  /**
   * Current stroke width / eraser radius, in the consumer's own units — this component
   * doesn't know or care what unit, it just renders a bounded numeric control.
   */
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
}

/**
 * Small, reasonably-saturated set of ink colors for a note-taking app. Local to this
 * component rather than a shared token, since these are content colors (what the user draws
 * with) not chrome colors (how the UI itself looks) — the two never mix per the package's
 * black/white/border-token chrome rule.
 */
const PRESET_COLORS = ["#000000", "#8b0000", "#1e5fd9", "#1b7a3d", "#e07b00", "#6b2fa8"];

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Live color/width settings editor for the currently active drawing tool. Purely
 * presentational — takes plain strings/numbers and callbacks, knows nothing about a "tool",
 * an ink stroke, or a PageEngine; a consumer in apps/desktop translates real
 * `InkSettingsRegistry` state into these props (mirrors how Minimap/TrashPanel define their
 * own local prop shapes instead of importing engine types).
 */
export function ToolSettingsPanel({
  toolLabel,
  color,
  onColorChange,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
}: ToolSettingsPanelProps) {
  const widthInputId = useId();
  const clampedWidth = clamp(width, minWidth, maxWidth);
  const isPresetColor = color !== null && PRESET_COLORS.includes(color);

  return (
    <Panel title={toolLabel}>
      <div className="renote-tool-settings-panel">
        {color !== null && (
          <div className="renote-tool-settings-color-section">
            <div className="renote-tool-settings-swatch-row">
              {PRESET_COLORS.map((preset) => {
                const selected = color === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-label={`Set color to ${preset}`}
                    aria-pressed={selected}
                    className={
                      selected
                        ? "renote-tool-settings-swatch renote-tool-settings-swatch-selected"
                        : "renote-tool-settings-swatch"
                    }
                    style={{ backgroundColor: preset }}
                    onClick={() => onColorChange(preset)}
                  />
                );
              })}
              <input
                type="color"
                aria-label="Custom color"
                className={
                  isPresetColor
                    ? "renote-tool-settings-custom-color"
                    : "renote-tool-settings-custom-color renote-tool-settings-swatch-selected"
                }
                value={color}
                onChange={(event) => onColorChange(event.target.value)}
              />
            </div>
          </div>
        )}
        <div className="renote-tool-settings-width-section">
          <label htmlFor={widthInputId} className="renote-tool-settings-width-label">
            Width <span className="renote-tool-settings-width-value">{clampedWidth}</span>
          </label>
          <input
            id={widthInputId}
            type="range"
            className="renote-tool-settings-width-slider"
            min={minWidth}
            max={maxWidth}
            value={clampedWidth}
            onChange={(event) => onWidthChange(Number(event.target.value))}
          />
        </div>
      </div>
    </Panel>
  );
}
