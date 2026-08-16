import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { TagSummaryPanel, type TagSummaryEntry } from "./TagSummaryPanel.js";

const tags: TagSummaryEntry[] = [
  { id: "tag-1", kind: "important", label: "Important", color: "#ff0000", noteCount: 3 },
  { id: "tag-2", kind: "to-do", label: "To Do", color: "#00ff00", noteCount: 1 },
];

function noop() {}

describe("TagSummaryPanel", () => {
  it("renders a Tags panel with each tag's label, kind, and note count", () => {
    render(
      <ThemeProvider>
        <TagSummaryPanel
          tags={tags}
          onSelectTag={noop}
          onCreateTag={noop}
          onRenameTag={noop}
          onDeleteTag={noop}
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole("region", { name: "Tags" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Important/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /To Do/ })).toBeInTheDocument();
    expect(screen.getByText(/3 notes/)).toBeInTheDocument();
    expect(screen.getByText(/1 note$/)).toBeInTheDocument();
  });

  it('shows "No tags yet" when tags is empty', () => {
    render(
      <ThemeProvider>
        <TagSummaryPanel
          tags={[]}
          onSelectTag={noop}
          onCreateTag={noop}
          onRenameTag={noop}
          onDeleteTag={noop}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText(/No tags yet/)).toBeInTheDocument();
  });

  it("calls onSelectTag with the tag's id when its row is clicked", () => {
    const onSelectTag = vi.fn();
    render(
      <ThemeProvider>
        <TagSummaryPanel
          tags={tags}
          onSelectTag={onSelectTag}
          onCreateTag={noop}
          onRenameTag={noop}
          onDeleteTag={noop}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Important/ }));
    expect(onSelectTag).toHaveBeenCalledWith("tag-1");
  });

  it("calls onDeleteTag with the tag's id when its Delete button is clicked", () => {
    const onDeleteTag = vi.fn();
    render(
      <ThemeProvider>
        <TagSummaryPanel
          tags={tags}
          onSelectTag={noop}
          onCreateTag={noop}
          onRenameTag={noop}
          onDeleteTag={onDeleteTag}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getAllByText("Delete")[0]!);
    expect(onDeleteTag).toHaveBeenCalledWith("tag-1");
  });

  it("calls onCreateTag with the form's kind/label/color when Add Tag is submitted", () => {
    const onCreateTag = vi.fn();
    render(
      <ThemeProvider>
        <TagSummaryPanel
          tags={tags}
          onSelectTag={noop}
          onCreateTag={onCreateTag}
          onRenameTag={noop}
          onDeleteTag={noop}
        />
      </ThemeProvider>,
    );

    fireEvent.change(screen.getByLabelText("New tag name"), { target: { value: "Follow Up" } });
    fireEvent.click(screen.getByText("Add Tag"));

    expect(onCreateTag).toHaveBeenCalledWith("custom", "Follow Up", expect.any(String));
  });

  it("disables Add Tag while the new tag name is empty", () => {
    render(
      <ThemeProvider>
        <TagSummaryPanel
          tags={tags}
          onSelectTag={noop}
          onCreateTag={noop}
          onRenameTag={noop}
          onDeleteTag={noop}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Add Tag")).toBeDisabled();
  });

  it("switches a tag row into edit mode and calls onRenameTag with the updated label", () => {
    const onRenameTag = vi.fn();
    render(
      <ThemeProvider>
        <TagSummaryPanel
          tags={tags}
          onSelectTag={noop}
          onCreateTag={noop}
          onRenameTag={onRenameTag}
          onDeleteTag={noop}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getAllByText("Edit")[0]!);
    fireEvent.change(screen.getByLabelText("Tag label"), { target: { value: "Very Important" } });
    fireEvent.click(screen.getByText("Save"));

    expect(onRenameTag).toHaveBeenCalledWith("tag-1", "Very Important", "#ff0000");
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <TagSummaryPanel
          tags={tags}
          onSelectTag={noop}
          onCreateTag={noop}
          onRenameTag={noop}
          onDeleteTag={noop}
        />
      </ThemeProvider>,
    );
    expect(screen.getByRole("region", { name: "Tags" })).toBeInTheDocument();
  });
});
