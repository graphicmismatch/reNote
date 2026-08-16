import { PixelButton } from "../primitives/PixelButton.js";
import { Panel } from "./Panel.js";
import "./AutosavePanel.css";

/**
 * Lightweight local shape rather than importing `AutosaveMetaDto` from
 * `@renote/storage-client` — this package has no dependency on it, matching
 * how `TrashPanel`/`HistoryPanel` define their own local entry shapes
 * instead of reaching into `@renote/storage-client` (see this package's
 * cross-cutting "never imports @tauri-apps/*, @renote/core, or
 * @renote/canvas-engine" convention).
 *
 * Distinct from `HistoryPanel`'s `HistoryEntry`: that panel is the
 * in-session, in-memory undo/redo command log (`CommandStack`), reset on
 * every page-engine remount; this is a cross-session, persisted-to-disk
 * safety-net copy (see `renote_storage::autosave`) that survives reloads
 * and app restarts — there is at most one of these per page at a time.
 */
export interface AutosaveEntry {
  timestamp: string; // ISO 8601
  sizeBytes: number;
  objectCount: number;
}

export interface AutosavePanelProps {
  /** `null` when the page has no autosave yet. */
  entry: AutosaveEntry | null;
  onRestore: () => void;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Per-page autosave status: the page's single autosave slot, taken
 * automatically on a timer at the interval the user picked in Settings (see
 * `SettingsDialog`'s "Autosave" section). Restoring it overwrites the
 * page's CURRENT live content — an irreversible-feeling action from the
 * user's point of view (though it itself leaves the live state one
 * autosave tick away from being captured again, so nothing is truly lost)
 * — so, like `TrashPanel`'s permanent-delete actions, "Restore Autosave"
 * gets bold/inverted styling instead of a native `confirm()` dialog: this
 * app is driven by an automated headless-Chrome harness that a blocking
 * dialog would break, so visual weight is the only distinction available.
 */
export function AutosavePanel({ entry, onRestore }: AutosavePanelProps) {
  return (
    <Panel title="Autosave">
      <div className="renote-autosave-panel">
        {entry === null ? (
          <div className="renote-autosave-panel-empty-state">No autosave yet</div>
        ) : (
          <div className="renote-autosave-panel-entry">
            <div className="renote-autosave-panel-entry-info">
              <div className="renote-autosave-panel-entry-name">
                Last autosaved {formatTimestamp(entry.timestamp)}
              </div>
              <div className="renote-autosave-panel-entry-meta">
                {entry.objectCount} object{entry.objectCount === 1 ? "" : "s"} · {formatSize(entry.sizeBytes)}
              </div>
            </div>
            <PixelButton type="button" className="renote-autosave-panel-restore" onClick={onRestore}>
              Restore Autosave
            </PixelButton>
          </div>
        )}
      </div>
    </Panel>
  );
}
