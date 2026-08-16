import { Panel } from "./Panel.js";
import "./BacklinksPanel.css";

/**
 * Local to this package on purpose — `packages/ui` must never import `@renote/core`/
 * `@renote/storage-client`'s generated `PageDto`, matching `TagSummaryPanel.tsx`'s own local
 * `TagSummaryEntry` for the same boundary reason. Just enough of a page to list and navigate to.
 */
export interface BacklinkEntry {
  id: string;
  title: string;
}

export interface BacklinksPanelProps {
  entries: BacklinkEntry[];
  /** Fired when a backlink entry is clicked — the caller wires this to open that page. */
  onSelect: (pageId: string) => void;
}

/**
 * "Linked Mentions" sidebar panel: every page whose content wikilinks to the page currently open,
 * matching `TagSummaryPanel.tsx`'s exact structural/styling template (a `Panel` wrapper, a local
 * lightweight entry type, clicking a row firing a callback the caller wires to navigation). A
 * page can appear in its own Linked Mentions list (a self-link) — this component renders
 * whatever `entries` it's given with no special-casing of that case.
 */
export function BacklinksPanel({ entries, onSelect }: BacklinksPanelProps) {
  return (
    <Panel title="Linked Mentions">
      <div className="renote-backlinks-panel">
        {entries.length === 0 ? (
          <div className="renote-backlinks-panel-empty-state">No linked mentions</div>
        ) : (
          <ul className="renote-backlinks-panel-list">
            {entries.map((entry) => (
              <li key={entry.id} className="renote-backlinks-panel-entry">
                <button
                  type="button"
                  className="renote-backlinks-panel-entry-main"
                  onClick={() => onSelect(entry.id)}
                >
                  <span className="renote-backlinks-panel-entry-title">{entry.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
