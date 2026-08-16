import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./ContextMenu.css";

export interface ContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  /** Draws a divider ABOVE this item — grouping without a separate item kind to render. */
  separatorBefore?: boolean;
}

export interface ContextMenuProps {
  /** Viewport coordinates of the right-click that opened this menu. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** Keeps the menu fully on screen when it opens near the right/bottom edge: flip it back inside
 *  rather than letting the viewport clip it. */
function clampToViewport(x: number, y: number, width: number, height: number) {
  const maxX = window.innerWidth - width - MARGIN_PX;
  const maxY = window.innerHeight - height - MARGIN_PX;
  return { x: Math.max(MARGIN_PX, Math.min(x, maxX)), y: Math.max(MARGIN_PX, Math.min(y, maxY)) };
}

const MARGIN_PX = 4;

/**
 * Right-click menu: a positioned list of commands, closed by choosing one, pressing Escape, or
 * clicking anywhere else. It is a pure presenter — the caller decides which items to offer and
 * what each one does, so the same menu component serves the canvas and the notebook tree without
 * knowing about either.
 *
 * Renders nothing when `items` is empty, so a caller can hand it a filtered list without also
 * having to decide whether to mount it.
 */
export function ContextMenu({ x, y, items, onSelect, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLUListElement>(null);
  const [position, setPosition] = useState({ x, y });

  // Measured after mount, before paint: the menu's size depends on its own item labels, so there
  // is nothing to clamp against until it exists.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition(clampToViewport(x, y, width, height));
  }, [x, y, items]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // `pointerdown` rather than `click`: the menu must be gone before whatever was clicked
    // underneath it starts handling the interaction.
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [onClose]);

  if (items.length === 0) return null;

  return (
    <ul
      ref={menuRef}
      className="renote-context-menu"
      role="menu"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      {items.map((item) => (
        <li key={item.id} role="none" className={item.separatorBefore ? "renote-context-menu-grouped" : ""}>
          <button
            type="button"
            role="menuitem"
            className="renote-context-menu-item"
            disabled={item.disabled}
            onClick={() => {
              onSelect(item.id);
              onClose();
            }}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
