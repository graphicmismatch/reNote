import { PixelButton } from "../primitives/PixelButton.js";
import "./Toolbar.css";

export interface ToolbarItem {
  id: string;
  label: string; // used as title/tooltip and accessible name
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface ToolbarGroup {
  items: ToolbarItem[];
}

export interface ToolbarProps {
  groups: ToolbarGroup[];
}

/** Horizontal button groups separated by dividers. */
export function Toolbar({ groups }: ToolbarProps) {
  return (
    <div className="renote-toolbar" role="toolbar">
      {groups.map((group, groupIndex) => (
        <div className="renote-toolbar-group" key={groupIndex}>
          {groupIndex > 0 ? <span className="renote-toolbar-divider" aria-hidden="true" /> : null}
          {group.items.map((item) => (
            <PixelButton
              key={item.id}
              type="button"
              title={item.label}
              aria-label={item.label}
              aria-pressed={item.active ?? false}
              disabled={item.disabled}
              className={["renote-toolbar-item", item.active ? "renote-toolbar-item-active" : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={item.onClick}
            >
              {item.label}
            </PixelButton>
          ))}
        </div>
      ))}
    </div>
  );
}
