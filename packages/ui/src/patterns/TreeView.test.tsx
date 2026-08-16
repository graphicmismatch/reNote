import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { TreeView, type TreeNode } from "./TreeView.js";

const nodes: TreeNode[] = [
  {
    id: "n1",
    label: "Notebook",
    depth: 0,
    hasChildren: true,
    expanded: true,
    selected: false,
    icon: "notebook",
  },
  {
    id: "s1",
    label: "Section",
    depth: 1,
    hasChildren: false,
    expanded: false,
    selected: true,
    icon: "section",
  },
];

describe("TreeView", () => {
  it("renders rows indented by depth with tree ARIA roles", () => {
    render(
      <ThemeProvider>
        <TreeView nodes={nodes} onToggleExpand={() => {}} onSelect={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("tree")).toBeInTheDocument();
    const items = screen.getAllByRole("treeitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("aria-level", "1");
    expect(items[1]).toHaveAttribute("aria-level", "2");
    expect(items[1]).toHaveAttribute("aria-selected", "true");
  });

  it("calls onSelect when a row is clicked", () => {
    const onSelect = vi.fn();
    render(
      <ThemeProvider>
        <TreeView nodes={nodes} onToggleExpand={() => {}} onSelect={onSelect} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("Section"));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("calls onToggleExpand (not onSelect) when the disclosure glyph is clicked", () => {
    const onSelect = vi.fn();
    const onToggleExpand = vi.fn();
    render(
      <ThemeProvider>
        <TreeView nodes={nodes} onToggleExpand={onToggleExpand} onSelect={onSelect} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(onToggleExpand).toHaveBeenCalledWith("n1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("double-clicking a label opens an inline edit input pre-filled with its current label", () => {
    render(
      <ThemeProvider>
        <TreeView nodes={nodes} onToggleExpand={() => {}} onSelect={() => {}} onRename={() => {}} />
      </ThemeProvider>,
    );

    fireEvent.doubleClick(screen.getByText("Section"));
    const input = screen.getByRole("textbox", { name: "Rename Section" }) as HTMLInputElement;
    expect(input.value).toBe("Section");
  });

  it("commits a rename on Enter and calls onRename with the trimmed value", () => {
    const onRename = vi.fn();
    const onSelect = vi.fn();
    render(
      <ThemeProvider>
        <TreeView nodes={nodes} onToggleExpand={() => {}} onSelect={onSelect} onRename={onRename} />
      </ThemeProvider>,
    );

    fireEvent.doubleClick(screen.getByText("Section"));
    const input = screen.getByRole("textbox", { name: "Rename Section" });
    fireEvent.change(input, { target: { value: "  Renamed Section  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRename).toHaveBeenCalledWith("s1", "Renamed Section");
    // Editing (and the click that ends it) must never also fire row selection.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("discards the edit on Escape without calling onRename", () => {
    const onRename = vi.fn();
    render(
      <ThemeProvider>
        <TreeView nodes={nodes} onToggleExpand={() => {}} onSelect={() => {}} onRename={onRename} />
      </ThemeProvider>,
    );

    fireEvent.doubleClick(screen.getByText("Section"));
    const input = screen.getByRole("textbox", { name: "Rename Section" });
    fireEvent.change(input, { target: { value: "Ignored" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("Section")).toBeInTheDocument();
  });

  it("does not open for editing when onRename is omitted", () => {
    render(
      <ThemeProvider>
        <TreeView nodes={nodes} onToggleExpand={() => {}} onSelect={() => {}} />
      </ThemeProvider>,
    );

    fireEvent.doubleClick(screen.getByText("Section"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <TreeView nodes={nodes} onToggleExpand={() => {}} onSelect={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("tree")).toBeInTheDocument();
  });
});
