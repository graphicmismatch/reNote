import { Panel } from "./Panel.js";
import "./RelatedNotesPanel.css";

/** Local to this package on purpose — same boundary reason as `BacklinksPanel.tsx`'s
 *  `BacklinkEntry`: just enough of a page to list and navigate to. */
export interface RelatedNoteEntry {
  id: string;
  title: string;
}

export interface RelatedNotesPanelProps {
  entries: RelatedNoteEntry[];
  /** Fired when a related-note entry is clicked — the caller wires this to open that page. */
  onSelect: (pageId: string) => void;
}

/**
 * "Related Notes" sidebar panel (Phase 13's local semantic layer): the open page's nearest
 * neighbours by embedding similarity, ranked highest-first. Structural/styling twin of
 * `BacklinksPanel.tsx` — a page carrying no relation to anything else (an empty notebook, or a
 * model budget miss the plan allows the phase to ship without) renders the same empty state a
 * page with no backlinks does, degrading silently rather than showing an error.
 */
export function RelatedNotesPanel({ entries, onSelect }: RelatedNotesPanelProps) {
  return (
    <Panel title="Related Notes">
      <div className="renote-related-notes-panel">
        {entries.length === 0 ? (
          <div className="renote-related-notes-panel-empty-state">No related notes</div>
        ) : (
          <ul className="renote-related-notes-panel-list">
            {entries.map((entry) => (
              <li key={entry.id} className="renote-related-notes-panel-entry">
                <button
                  type="button"
                  className="renote-related-notes-panel-entry-main"
                  onClick={() => onSelect(entry.id)}
                >
                  <span className="renote-related-notes-panel-entry-title">{entry.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
