import { Panel } from "./Panel.js";
import "./TaggedParagraphsPanel.css";

/**
 * Local to this package on purpose — same boundary reason as `BacklinksPanel.tsx`'s own
 * `BacklinkEntry`: just enough of a tagged paragraph to list and navigate to, no
 * `@renote/storage-client` generated type imported here.
 */
export interface TaggedParagraphEntry {
  /** Stable list key — `pageId` alone isn't unique when a page has more than one tagged
   *  paragraph, so the caller combines it with `objectId`. */
  id: string;
  pageId: string;
  pageTitle: string;
  objectId: string;
  text: string;
}

export interface TaggedParagraphsPanelProps {
  /** The selected tag's own label, shown in the panel title (e.g. `"To Do" lines`). */
  tagLabel: string;
  entries: TaggedParagraphEntry[];
  /** Fired when an entry is clicked — the caller wires this to navigate to that paragraph. */
  onSelect: (entry: TaggedParagraphEntry) => void;
}

/**
 * "To-do rollup" (Phase 11.3) sidebar panel: every paragraph across the notebook carrying the
 * currently selected tag, shown as its own actual text rather than just the page it lives on —
 * matches `BacklinksPanel.tsx`'s exact structural/styling template. Rendered only while a tag is
 * selected; the caller decides that, this component just lists whatever `entries` it's given.
 */
export function TaggedParagraphsPanel({ tagLabel, entries, onSelect }: TaggedParagraphsPanelProps) {
  return (
    <Panel title={`"${tagLabel}" lines`}>
      <div className="renote-tagged-paragraphs-panel">
        {entries.length === 0 ? (
          <div className="renote-tagged-paragraphs-panel-empty-state">No tagged paragraphs</div>
        ) : (
          <ul className="renote-tagged-paragraphs-panel-list">
            {entries.map((entry) => (
              <li key={entry.id} className="renote-tagged-paragraphs-panel-entry">
                <button
                  type="button"
                  className="renote-tagged-paragraphs-panel-entry-main"
                  onClick={() => onSelect(entry)}
                >
                  <span className="renote-tagged-paragraphs-panel-entry-text">
                    {entry.text.trim() || "(empty)"}
                  </span>
                  <span className="renote-tagged-paragraphs-panel-entry-page">{entry.pageTitle}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
