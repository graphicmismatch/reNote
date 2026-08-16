import { PixelButton } from "../primitives/PixelButton.js";
import { Panel } from "./Panel.js";
import "./TrashPanel.css";

export type TrashEntryKind = "notebook" | "section-group" | "section" | "page";

/**
 * Lightweight local shape rather than importing `TrashEntryDto` from
 * `@renote/storage-client` — this package has no dependency on it, matching
 * how `HistoryPanel`/`SearchPanel` define their own `HistoryEntry`/
 * `SearchResultItem` instead of reaching into `@renote/storage-client`.
 */
export interface TrashEntry {
  id: string;
  kind: TrashEntryKind;
  name: string;
  deletedAt: string; // ISO timestamp
}

export interface TrashPanelProps {
  entries: TrashEntry[];
  onRestore: (entryId: string) => void;
  onEmptyEntry: (entryId: string) => void;
  onEmptyAll: () => void;
}

const KIND_LABELS: Record<TrashEntryKind, string> = {
  notebook: "Notebook",
  "section-group": "Section Group",
  section: "Section",
  page: "Page",
};

function formatDeletedAt(deletedAt: string): string {
  const date = new Date(deletedAt);
  if (Number.isNaN(date.getTime())) return deletedAt;
  return date.toLocaleString();
}

/**
 * Recycle-bin listing. Restore is reversible and gets the normal button
 * treatment; emptying a single entry or the whole bin is not reversible, so
 * those actions use inverted, bold styling instead of a native `confirm()`
 * dialog — this app is driven by an automated headless-Chrome harness that a
 * blocking dialog would break, so visual weight is the only distinction
 * available.
 */
export function TrashPanel({ entries, onRestore, onEmptyEntry, onEmptyAll }: TrashPanelProps) {
  return (
    <Panel title="Trash">
      <div className="renote-trash-panel">
        <PixelButton
          type="button"
          className="renote-trash-panel-empty-all"
          onClick={onEmptyAll}
          disabled={entries.length === 0}
        >
          Empty Trash
        </PixelButton>
        {entries.length === 0 ? (
          <div className="renote-trash-panel-empty-state">Trash is empty</div>
        ) : (
          <ul className="renote-trash-panel-list">
            {entries.map((entry) => (
              <li key={entry.id} className="renote-trash-panel-entry">
                <div className="renote-trash-panel-entry-info">
                  <div className="renote-trash-panel-entry-name">{entry.name}</div>
                  <div className="renote-trash-panel-entry-meta">
                    {KIND_LABELS[entry.kind]} · {formatDeletedAt(entry.deletedAt)}
                  </div>
                </div>
                <div className="renote-trash-panel-entry-actions">
                  <PixelButton
                    type="button"
                    className="renote-trash-panel-restore"
                    onClick={() => onRestore(entry.id)}
                  >
                    Restore
                  </PixelButton>
                  <PixelButton
                    type="button"
                    className="renote-trash-panel-delete"
                    onClick={() => onEmptyEntry(entry.id)}
                  >
                    Delete Permanently
                  </PixelButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
