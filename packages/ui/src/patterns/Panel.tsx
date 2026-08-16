import { useState, type ReactNode } from "react";
import "./Panel.css";

export interface PanelProps {
  title: string;
  children: ReactNode;
}

/**
 * Generic bordered, titled container used to wrap side panels. Collapsible: the title strip's
 * toggle button folds the panel down to just its own height, and its sibling panels within the
 * same sidebar (each `flex: 1` or a fixed weight — see index.css) automatically claim the space
 * a collapsed panel gives up, and give it back when re-expanded, since that redistribution is
 * plain flexbox and needs no JS here.
 */
export function Panel({ title, children }: PanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      className={collapsed ? "renote-panel renote-panel-collapsed" : "renote-panel"}
      aria-label={title}
    >
      <div className="renote-panel-title-strip">
        <button
          type="button"
          className="renote-panel-collapse-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span className="renote-panel-title">{title}</span>
      </div>
      {!collapsed && <div className="renote-panel-content">{children}</div>}
    </section>
  );
}
