import { PixelButton } from "../primitives/PixelButton.js";
import "./FindBar.css";

export interface FindBarProps {
  query: string;
  /** How many objects on the page match `query`; 0 when there's no match or the query is empty. */
  matchCount: number;
  /** 0-based index of the current match within `matchCount`, or -1 when there's no current match. */
  currentIndex: number;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

/**
 * A small floating find-in-page bar (Phase 11.6) — Enter/Shift+Enter step through matches the
 * same way a browser's own Ctrl+F does, Escape closes. Purely presentational: the caller owns
 * matching against page objects and camera centering, this only renders the query/count/controls
 * it's given and reports intent.
 */
export function FindBar({
  query,
  matchCount,
  currentIndex,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
}: FindBarProps) {
  return (
    <div className="renote-find-bar" role="search">
      <input
        type="text"
        className="renote-find-bar-input"
        value={query}
        autoFocus
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder="Find in page…"
        aria-label="Find in page"
      />
      <span className="renote-find-bar-count">
        {matchCount === 0 ? "No results" : `${currentIndex + 1} / ${matchCount}`}
      </span>
      <PixelButton type="button" onClick={onPrevious} disabled={matchCount === 0} aria-label="Previous match">
        ↑
      </PixelButton>
      <PixelButton type="button" onClick={onNext} disabled={matchCount === 0} aria-label="Next match">
        ↓
      </PixelButton>
      <PixelButton type="button" onClick={onClose} aria-label="Close find bar">
        ✕
      </PixelButton>
    </div>
  );
}
