import { useState, type ChangeEvent, type FormEvent } from "react";
import { PixelButton } from "../primitives/PixelButton.js";
import { Panel } from "./Panel.js";
import "./TagSummaryPanel.css";

/**
 * Local to this package on purpose — `packages/ui` must never import
 * `@renote/core` (or `@renote/storage-client`'s generated `TagDto`), so
 * this mirrors whatever the real tag kind union looks like on the domain
 * side rather than importing it. Matches `TrashPanel.tsx`'s own local
 * `TrashEntryKind` for the same reason.
 */
export type TagSummaryKind = "to-do" | "important" | "question" | "idea" | "definition" | "custom";

export interface TagSummaryEntry {
  id: string;
  kind: TagSummaryKind;
  label: string;
  color: string;
  /** How many notes/pages currently carry this tag. */
  noteCount: number;
}

export interface TagSummaryPanelProps {
  tags: TagSummaryEntry[];
  /** Fired when a tag row is clicked — the caller wires this to a tag-filtered search. */
  onSelectTag: (tagId: string) => void;
  onCreateTag: (kind: TagSummaryKind, label: string, color: string) => void;
  onRenameTag: (tagId: string, label: string, color: string) => void;
  onDeleteTag: (tagId: string) => void;
}

const KIND_OPTIONS: ReadonlyArray<{ value: TagSummaryKind; label: string }> = [
  { value: "to-do", label: "To Do" },
  { value: "important", label: "Important" },
  { value: "question", label: "Question" },
  { value: "idea", label: "Idea" },
  { value: "definition", label: "Definition" },
  { value: "custom", label: "Custom" },
];

const KIND_LABELS: Record<TagSummaryKind, string> = Object.fromEntries(
  KIND_OPTIONS.map(({ value, label }) => [value, label]),
) as Record<TagSummaryKind, string>;

const DEFAULT_NEW_TAG_COLOR = "#f4c430";

/**
 * Sidebar listing of a notebook's tags with per-tag note counts, matching
 * `TrashPanel.tsx`'s structural/styling template (a `Panel` wrapper,
 * `PixelButton`s, a local lightweight entry type). Clicking a tag's row
 * fires `onSelectTag` (the caller wires this to a tag-filtered search,
 * reusing whatever search-hit rendering already exists rather than this
 * panel owning its own results list). Inline forms — styled with
 * `SettingsDialog.tsx`'s row conventions — cover create/rename/recolor/
 * delete without a separate modal.
 */
export function TagSummaryPanel({
  tags,
  onSelectTag,
  onCreateTag,
  onRenameTag,
  onDeleteTag,
}: TagSummaryPanelProps) {
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState("#000000");

  const [newTagKind, setNewTagKind] = useState<TagSummaryKind>("custom");
  const [newTagLabel, setNewTagLabel] = useState("");
  const [newTagColor, setNewTagColor] = useState(DEFAULT_NEW_TAG_COLOR);

  const beginEdit = (tag: TagSummaryEntry) => {
    setEditingTagId(tag.id);
    setEditLabel(tag.label);
    setEditColor(tag.color);
  };

  const cancelEdit = () => {
    setEditingTagId(null);
  };

  const submitEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingTagId || editLabel.trim() === "") return;
    onRenameTag(editingTagId, editLabel.trim(), editColor);
    setEditingTagId(null);
  };

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    if (newTagLabel.trim() === "") return;
    onCreateTag(newTagKind, newTagLabel.trim(), newTagColor);
    setNewTagLabel("");
    setNewTagColor(DEFAULT_NEW_TAG_COLOR);
  };

  return (
    <Panel title="Tags">
      <div className="renote-tag-summary-panel">
        {tags.length === 0 ? (
          <div className="renote-tag-summary-panel-empty-state">
            No tags yet. Create one below, then apply it to a paragraph while editing a text box (the tag
            picker above the text appears once the notebook has at least one tag).
          </div>
        ) : (
          <ul className="renote-tag-summary-panel-list">
            {tags.map((tag) =>
              editingTagId === tag.id ? (
                <li key={tag.id} className="renote-tag-summary-panel-entry">
                  <form className="renote-tag-summary-panel-edit-form" onSubmit={submitEdit}>
                    <div className="renote-tag-summary-panel-row">
                      <input
                        type="text"
                        className="renote-tag-summary-panel-input"
                        value={editLabel}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => setEditLabel(event.target.value)}
                        aria-label="Tag label"
                      />
                      <input
                        type="color"
                        className="renote-tag-summary-panel-color-input"
                        value={editColor}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => setEditColor(event.target.value)}
                        aria-label="Tag color"
                      />
                    </div>
                    <div className="renote-tag-summary-panel-entry-actions">
                      <PixelButton type="submit">Save</PixelButton>
                      <PixelButton type="button" onClick={cancelEdit}>
                        Cancel
                      </PixelButton>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={tag.id} className="renote-tag-summary-panel-entry">
                  <button
                    type="button"
                    className="renote-tag-summary-panel-entry-main"
                    onClick={() => onSelectTag(tag.id)}
                  >
                    <span
                      className="renote-tag-summary-panel-swatch"
                      style={{ backgroundColor: tag.color }}
                      aria-hidden="true"
                    />
                    <span className="renote-tag-summary-panel-entry-info">
                      <span className="renote-tag-summary-panel-entry-label">{tag.label}</span>
                      <span className="renote-tag-summary-panel-entry-meta">
                        {KIND_LABELS[tag.kind]} · {tag.noteCount} {tag.noteCount === 1 ? "note" : "notes"}
                      </span>
                    </span>
                  </button>
                  <div className="renote-tag-summary-panel-entry-actions">
                    <PixelButton type="button" onClick={() => beginEdit(tag)}>
                      Edit
                    </PixelButton>
                    <PixelButton
                      type="button"
                      className="renote-tag-summary-panel-delete"
                      onClick={() => onDeleteTag(tag.id)}
                    >
                      Delete
                    </PixelButton>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
        <form className="renote-tag-summary-panel-create-form" onSubmit={submitCreate}>
          <div className="renote-tag-summary-panel-row">
            <select
              className="renote-tag-summary-panel-select"
              value={newTagKind}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setNewTagKind(event.target.value as TagSummaryKind)
              }
              aria-label="New tag kind"
            >
              {KIND_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="color"
              className="renote-tag-summary-panel-color-input"
              value={newTagColor}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setNewTagColor(event.target.value)}
              aria-label="New tag color"
            />
          </div>
          <div className="renote-tag-summary-panel-row">
            <input
              type="text"
              className="renote-tag-summary-panel-input"
              placeholder="New tag name…"
              value={newTagLabel}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setNewTagLabel(event.target.value)}
              aria-label="New tag name"
            />
            <PixelButton type="submit" disabled={newTagLabel.trim() === ""}>
              Add Tag
            </PixelButton>
          </div>
        </form>
      </div>
    </Panel>
  );
}
