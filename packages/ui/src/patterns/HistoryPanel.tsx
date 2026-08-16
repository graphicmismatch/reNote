import { Panel } from "./Panel.js";
import "./HistoryPanel.css";

export interface HistoryEntry {
  id: string;
  label: string; // e.g. "Add stroke", "Move object"
}

export interface HistoryPanelProps {
  entries: HistoryEntry[];
  pointerIndex: number; // index into entries currently active; -1 = before the first entry (nothing done yet)
  onJumpTo: (index: number) => void; // -1 is a valid argument (jump to "before everything")
}

/**
 * Paint.NET-style clickable undo/redo history. Entries at or before
 * `pointerIndex` are "applied" (normal); entries after it are "undone"
 * (dimmed, still visible and clickable to redo forward to them).
 */
export function HistoryPanel({ entries, pointerIndex, onJumpTo }: HistoryPanelProps) {
  return (
    <Panel title="History">
      <ul className="renote-history-panel-list">
        <li
          role="button"
          tabIndex={0}
          className={[
            "renote-history-panel-entry",
            pointerIndex === -1 ? "renote-history-panel-entry-applied" : "renote-history-panel-entry-undone",
          ].join(" ")}
          aria-current={pointerIndex === -1}
          onClick={() => onJumpTo(-1)}
        >
          (start)
        </li>
        {entries.map((entry, index) => (
          <li
            key={entry.id}
            role="button"
            tabIndex={0}
            className={[
              "renote-history-panel-entry",
              index <= pointerIndex
                ? "renote-history-panel-entry-applied"
                : "renote-history-panel-entry-undone",
            ].join(" ")}
            aria-current={index === pointerIndex}
            onClick={() => onJumpTo(index)}
          >
            {entry.label}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
