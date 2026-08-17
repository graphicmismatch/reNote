import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { PixelButton } from "../primitives/PixelButton.js";
import "./Toolbar.css";

export interface ToolbarItem {
  id: string;
  label: string; // used as button text, title/tooltip, and accessible name
  /** Optional leading glyph/image shown before the label — a single character renders as
   *  text; anything else (e.g. an <img> for custom pixel-art icons) is rendered as-is. */
  icon?: ReactNode;
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

const DEFAULT_POSITION = { top: 12, left: 12 };

/**
 * Free-floating vertical tool palette, styled as its own small draggable "window" to match the
 * bordered/pinstripe-titled look of the sidebar's `Panel`s (mirrors `Panel.css`'s tokens rather
 * than importing it — every pattern component here owns its own CSS file). Dragging is by the
 * title strip, same as moving a real window; the collapse toggle stops its own pointerdown from
 * propagating so clicking it doesn't also start a drag.
 *
 * Position is clamped to its positioned ancestor (the drawing area, `.renote-main`) so it can't
 * be dragged off the canvas or under a sidebar. Drag tracking uses window-level
 * pointermove/pointerup listeners rather than `setPointerCapture` — window-level bubbling is
 * enough and behaves more predictably once the pointer leaves the title strip.
 */
export function Toolbar({ groups }: ToolbarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(DEFAULT_POSITION);
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const dragOrigin = useRef({ pointerX: 0, pointerY: 0, top: 0, left: 0 });

  const clampToParent = useCallback((top: number, left: number) => {
    const root = rootRef.current;
    const parent = root?.offsetParent as HTMLElement | null;
    if (!root || !parent) return { top, left };
    const maxLeft = Math.max(0, parent.clientWidth - root.offsetWidth);
    const maxTop = Math.max(0, parent.clientHeight - root.offsetHeight);
    return { top: Math.min(Math.max(top, 0), maxTop), left: Math.min(Math.max(left, 0), maxLeft) };
  }, []);

  const handleTitleStripPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragOrigin.current = { pointerX: event.clientX, pointerY: event.clientY, top: position.top, left: position.left };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (event: PointerEvent) => {
      const { pointerX, pointerY, top, left } = dragOrigin.current;
      setPosition(clampToParent(top + (event.clientY - pointerY), left + (event.clientX - pointerX)));
    };
    const handleUp = () => setDragging(false);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, clampToParent]);

  return (
    <div ref={rootRef} className="renote-toolbar" style={{ top: position.top, left: position.left }}>
      <div className="renote-toolbar-title-strip" onPointerDown={handleTitleStripPointerDown}>
        <button
          type="button"
          className="renote-toolbar-collapse-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand toolbar" : "Collapse toolbar"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span className="renote-toolbar-title">Tools</span>
      </div>
      {!collapsed && (
        <div className="renote-toolbar-body" role="toolbar">
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
                  <span className="renote-toolbar-item-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="renote-toolbar-item-label">{item.label}</span>
                </PixelButton>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
