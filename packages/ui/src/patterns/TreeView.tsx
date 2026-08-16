import { useState, type DragEvent, type KeyboardEvent } from "react";
import { useTheme } from "../theme-provider/ThemeProvider.js";
import "./TreeView.css";

export interface TreeNode {
  id: string;
  label: string;
  depth: number; // indentation level, 0 = root
  hasChildren: boolean;
  expanded: boolean;
  selected: boolean;
  icon?: "notebook" | "section-group" | "section" | "page";
}

export interface TreeViewProps {
  nodes: TreeNode[]; // already in visible display order
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  /** Double-clicking a row's label commits a new name here (trimmed, non-empty only) instead of
   *  it opening for edit — the row's usual double-click-to-select behavior. Omit to disable
   *  renaming entirely (the label stays a plain, non-interactive span). */
  onRename?: (id: string, label: string) => void;
  /** Right-clicking a row reports the row and the viewport position to open a menu at. Omit to
   *  leave the browser's own menu alone. */
  onContextMenu?: (id: string, x: number, y: number) => void;
  /**
   * A row was dragged onto another row. `position` is `"inside"` when it was dropped on the middle
   * of the target (move it under there) and `"before"`/`"after"` when it was dropped near an edge
   * (put it there among the target's siblings). The caller decides which combinations are legal —
   * this component reports the gesture and nothing more. Omit to disable dragging entirely.
   */
  onMoveNode?: (sourceId: string, targetId: string, position: DropPosition) => void;
}

export type DropPosition = "before" | "after" | "inside";

/** How close to a row's top/bottom edge a drop counts as "between rows" rather than "onto this
 *  row" — a quarter of the row each way, leaving the middle half as the drop-into target. */
const EDGE_FRACTION = 0.25;

function dropPositionFor(event: DragEvent<HTMLLIElement>): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  const offset = (event.clientY - rect.top) / rect.height;
  if (offset < EDGE_FRACTION) return "before";
  if (offset > 1 - EDGE_FRACTION) return "after";
  return "inside";
}

const INDENT_PX_PER_LEVEL = 16;

/**
 * Flat, pre-indented tree list. The caller owns flattening and expansion
 * state — this component has no recursion or domain knowledge, it just
 * renders `nodes` in the order given and reports interactions.
 */
export function TreeView({
  nodes,
  onToggleExpand,
  onSelect,
  onRename,
  onContextMenu,
  onMoveNode,
}: TreeViewProps) {
  const { tokens } = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null);

  const beginEditing = (node: TreeNode) => {
    if (!onRename) return;
    setEditingId(node.id);
    setEditingValue(node.label);
  };

  const commitEditing = () => {
    if (editingId === null) return;
    const trimmed = editingValue.trim();
    const original = nodes.find((n) => n.id === editingId)?.label;
    if (trimmed && trimmed !== original) onRename?.(editingId, trimmed);
    setEditingId(null);
  };

  const handleEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitEditing();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setEditingId(null);
    }
  };

  return (
    <ul className="renote-tree-view" role="tree">
      {nodes.map((node) => (
        <li
          key={node.id}
          role="treeitem"
          aria-selected={node.selected}
          aria-expanded={node.hasChildren ? node.expanded : undefined}
          aria-level={node.depth + 1}
          className={[
            "renote-tree-view-row",
            node.selected ? "renote-tree-view-row-selected" : "",
            dropTarget?.id === node.id ? `renote-tree-view-drop-${dropTarget.position}` : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{ paddingLeft: node.depth * INDENT_PX_PER_LEVEL }}
          draggable={onMoveNode !== undefined && editingId !== node.id}
          onDragStart={(event) => {
            setDraggingId(node.id);
            event.dataTransfer.effectAllowed = "move";
            // Some browsers refuse to start a drag without any payload set.
            event.dataTransfer.setData("text/plain", node.id);
          }}
          onDragEnd={() => {
            setDraggingId(null);
            setDropTarget(null);
          }}
          onDragOver={(event) => {
            if (!onMoveNode || draggingId === null || draggingId === node.id) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const position = dropPositionFor(event);
            setDropTarget((previous) =>
              previous?.id === node.id && previous.position === position
                ? previous
                : { id: node.id, position },
            );
          }}
          onDragLeave={() => {
            setDropTarget((previous) => (previous?.id === node.id ? null : previous));
          }}
          onDrop={(event) => {
            if (!onMoveNode) return;
            // The payload set in `onDragStart` is the source of truth here — `draggingId` is only
            // a fallback, since a drop can arrive from a drag this component never saw start.
            const sourceId = event.dataTransfer.getData("text/plain") || draggingId;
            if (!sourceId || sourceId === node.id) return;
            event.preventDefault();
            const position = dropPositionFor(event);
            setDropTarget(null);
            setDraggingId(null);
            onMoveNode(sourceId, node.id, position);
          }}
          onClick={() => onSelect(node.id)}
          onContextMenu={
            onContextMenu &&
            ((event) => {
              event.preventDefault();
              onContextMenu(node.id, event.clientX, event.clientY);
            })
          }
        >
          {node.hasChildren ? (
            <button
              type="button"
              className="renote-tree-view-disclosure"
              aria-label={node.expanded ? "Collapse" : "Expand"}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand(node.id);
              }}
            >
              {node.expanded ? tokens.disclosureExpandedGlyph : tokens.disclosureCollapsedGlyph}
            </button>
          ) : (
            <span className="renote-tree-view-disclosure-spacer" aria-hidden="true" />
          )}
          {node.icon ? (
            <span className={`renote-tree-view-icon renote-tree-view-icon-${node.icon}`} aria-hidden="true" />
          ) : null}
          {editingId === node.id ? (
            <input
              type="text"
              className="renote-tree-view-label-input"
              value={editingValue}
              autoFocus
              onChange={(event) => setEditingValue(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onBlur={commitEditing}
              onKeyDown={handleEditKeyDown}
              aria-label={`Rename ${node.label}`}
            />
          ) : (
            <span
              className="renote-tree-view-label"
              onDoubleClick={(event) => {
                if (!onRename) return;
                event.stopPropagation();
                beginEditing(node);
              }}
            >
              {node.label}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
