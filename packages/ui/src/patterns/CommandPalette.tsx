import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import "./CommandPalette.css";

export interface CommandPaletteItem {
  id: string;
  label: string;
  shortcut?: string | null; // a display string like "Mod+Z", already formatted by the caller — just render it, don't reformat it
}

export interface CommandPaletteProps {
  open: boolean;
  query: string;
  items: CommandPaletteItem[]; // already filtered/ranked by the caller — this component does NOT filter, it just renders what it's given
  onQueryChange: (query: string) => void;
  onExecute: (id: string) => void;
  onClose: () => void;
}

/**
 * Mod+K-style command palette overlay. The caller owns the keyboard shortcut
 * that opens it, and owns filtering/ranking of `items` — this component only
 * renders/behaves once `open` is true, and renders `items` as given.
 */
export function CommandPalette({
  open,
  query,
  items,
  onQueryChange,
  onExecute,
  onClose,
}: CommandPaletteProps) {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset on a stable key derived from item identity, not array identity —
  // the caller re-filters into a fresh array on every keystroke, so keying
  // off `items` itself would reset the highlight on every render. `open` is
  // also a dependency so reopening the palette resets the highlight even
  // when it lands on the exact same item set as last time (e.g. the caller
  // resets its query to "" on open, producing the same "show all" list) —
  // without it, the palette would silently keep whatever was highlighted
  // when it was last closed instead of starting fresh.
  const itemsKey = items.map((item) => item.id).join(",");
  useEffect(() => {
    setHighlightedIndex(0);
  }, [itemsKey, open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  // Clamp defensively: the reset above runs in an effect (after paint), so
  // there's a render where a shorter `items` list is paired with a stale
  // index. Clamping at read time keeps that window harmless.
  const activeIndex = items.length === 0 ? 0 : Math.min(highlightedIndex, items.length - 1);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (items.length > 0) {
        setHighlightedIndex((activeIndex + 1) % items.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length > 0) {
        setHighlightedIndex((activeIndex - 1 + items.length) % items.length);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[activeIndex];
      if (item) {
        onExecute(item.id);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="renote-command-palette-backdrop" onClick={onClose}>
      <div
        className="renote-command-palette-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="renote-command-palette-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command…"
          aria-label="Command"
        />
        {items.length === 0 ? (
          <div className="renote-command-palette-empty">No matching commands</div>
        ) : (
          <ul className="renote-command-palette-list" role="listbox">
            {items.map((item, index) => (
              <li
                key={item.id}
                role="option"
                aria-selected={index === activeIndex}
                className={[
                  "renote-command-palette-item",
                  index === activeIndex ? "renote-command-palette-item-highlighted" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => onExecute(item.id)}
              >
                <span className="renote-command-palette-item-label">{item.label}</span>
                {item.shortcut ? (
                  <span className="renote-command-palette-item-shortcut">{item.shortcut}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
