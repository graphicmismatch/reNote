import { useEffect, useId, type ChangeEvent } from "react";
import "./SettingsDialog.css";

/**
 * Local to this package on purpose — `packages/ui` must never import
 * `@renote/canvas-engine` or `@renote/core`, so this mirrors whatever the real
 * pointer-source type looks like on the engine side rather than importing it.
 */
export type PointerSourceOption = "mouse" | "pen" | "touch";

export interface PointerSourceOverrideSettings {
  mouse?: PointerSourceOption;
  pen?: PointerSourceOption;
  touch?: PointerSourceOption;
}

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  pointerSourceOverrides: PointerSourceOverrideSettings;
  /** `target` is null to clear the override for that source (back to "Default", i.e. trust
   *  whatever the OS/browser reports). */
  onPointerSourceOverrideChange: (source: PointerSourceOption, target: PointerSourceOption | null) => void;
  /** How often the app autosaves the open page, in whole seconds. `0` turns autosave off. */
  autosaveIntervalSeconds: number;
  onAutosaveIntervalSecondsChange: (seconds: number) => void;
  /** Whether the pen tool tries to recognize a drawn shape (line/rectangle/ellipse) and commit
   *  it as a shape object instead of raw ink. Off by default. */
  recognizeShapes: boolean;
  onRecognizeShapesChange: (value: boolean) => void;
}

const POINTER_SOURCE_ROWS: ReadonlyArray<{ source: PointerSourceOption; label: string }> = [
  { source: "mouse", label: "Mouse" },
  { source: "pen", label: "Pen / Stylus" },
  { source: "touch", label: "Touch" },
];

/**
 * App-level Settings surface. Presentational only — the caller (apps/desktop) owns reading
 * and persisting the actual override state; this component just renders `pointerSourceOverrides`
 * and reports intent via `onPointerSourceOverrideChange`.
 *
 * Structured as a general "Settings" dialog with one "Pointer Input" section today, but the
 * title/section wrapper markup (`renote-settings-dialog-section`) is intentionally reusable so
 * future sections can be appended without restructuring the dialog chrome.
 */
export function SettingsDialog({
  open,
  onClose,
  pointerSourceOverrides,
  onPointerSourceOverrideChange,
  autosaveIntervalSeconds,
  onAutosaveIntervalSecondsChange,
  recognizeShapes,
  onRecognizeShapesChange,
}: SettingsDialogProps): JSX.Element | null {
  // Mirrors CommandPalette's Escape-to-close, but as a window listener rather than an
  // onKeyDown on a focused input — this dialog has no single input that always has focus
  // (the user may be interacting with any of the three <select> rows).
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

  const handleRowChange = (source: PointerSourceOption) => (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    onPointerSourceOverrideChange(source, value === "" ? null : (value as PointerSourceOption));
  };

  const handleAutosaveIntervalChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Math.floor(Number(event.target.value));
    onAutosaveIntervalSecondsChange(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
  };

  const autosaveIntervalId = `${idPrefix}-autosave-interval`;
  const recognizeShapesId = `${idPrefix}-recognize-shapes`;

  return (
    <div className="renote-settings-dialog-backdrop" onClick={onClose}>
      <div
        className="renote-settings-dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="renote-settings-dialog-title">Settings</div>
        <section className="renote-settings-dialog-section">
          <span className="renote-settings-dialog-section-title">Pointer Input</span>
          <p className="renote-settings-dialog-section-description">
            Override how a specific input device type is treated, for hardware the OS misreports.
          </p>
          <div className="renote-settings-dialog-row-list">
            {POINTER_SOURCE_ROWS.map(({ source, label }) => {
              const rowId = `${idPrefix}-${source}`;
              return (
                <div className="renote-settings-dialog-row" key={source}>
                  <label className="renote-settings-dialog-row-label" htmlFor={rowId}>
                    {label}
                  </label>
                  <select
                    id={rowId}
                    className="renote-settings-dialog-select"
                    value={pointerSourceOverrides[source] ?? ""}
                    onChange={handleRowChange(source)}
                  >
                    <option value="">Default</option>
                    <option value="mouse">Treat as Mouse</option>
                    <option value="pen">Treat as Pen</option>
                    <option value="touch">Treat as Touch</option>
                  </select>
                </div>
              );
            })}
          </div>
        </section>
        <section className="renote-settings-dialog-section">
          <span className="renote-settings-dialog-section-title">Autosave</span>
          <p className="renote-settings-dialog-section-description">
            How often to autosave the open page, in seconds. Set to 0 to turn autosave off.
          </p>
          <div className="renote-settings-dialog-row-list">
            <div className="renote-settings-dialog-row">
              <label className="renote-settings-dialog-row-label" htmlFor={autosaveIntervalId}>
                Autosave every (seconds)
              </label>
              <input
                id={autosaveIntervalId}
                type="number"
                min={0}
                max={3600}
                step={1}
                className="renote-settings-dialog-number-input"
                value={autosaveIntervalSeconds}
                onChange={handleAutosaveIntervalChange}
              />
            </div>
          </div>
        </section>
        <section className="renote-settings-dialog-section">
          <span className="renote-settings-dialog-section-title">Drawing</span>
          <p className="renote-settings-dialog-section-description">
            Recognize a drawn line, rectangle, or ellipse and commit it as a clean shape instead of raw ink.
          </p>
          <div className="renote-settings-dialog-row-list">
            <div className="renote-settings-dialog-row">
              <label className="renote-settings-dialog-row-label" htmlFor={recognizeShapesId}>
                Recognize shapes while drawing
              </label>
              <input
                id={recognizeShapesId}
                type="checkbox"
                checked={recognizeShapes}
                onChange={(event) => onRecognizeShapesChange(event.target.checked)}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
