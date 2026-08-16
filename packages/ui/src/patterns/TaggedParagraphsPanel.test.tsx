import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { TaggedParagraphsPanel, type TaggedParagraphEntry } from "./TaggedParagraphsPanel.js";

const entries: TaggedParagraphEntry[] = [
  { id: "p1:o1", pageId: "p1", pageTitle: "Groceries", objectId: "o1", text: "Buy milk" },
  { id: "p2:o2", pageId: "p2", pageTitle: "Errands", objectId: "o2", text: "Call Alex" },
];

function noop() {}

describe("TaggedParagraphsPanel", () => {
  it("renders a panel titled after the tag, listing each entry's text and page", () => {
    render(
      <ThemeProvider>
        <TaggedParagraphsPanel tagLabel="To Do" entries={entries} onSelect={noop} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("region", { name: '"To Do" lines' })).toBeInTheDocument();
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("Call Alex")).toBeInTheDocument();
    expect(screen.getByText("Errands")).toBeInTheDocument();
  });

  it('shows "No tagged paragraphs" when entries is empty', () => {
    render(
      <ThemeProvider>
        <TaggedParagraphsPanel tagLabel="To Do" entries={[]} onSelect={noop} />
      </ThemeProvider>,
    );

    expect(screen.getByText("No tagged paragraphs")).toBeInTheDocument();
  });

  it("calls onSelect with the clicked entry", () => {
    const onSelect = vi.fn();
    render(
      <ThemeProvider>
        <TaggedParagraphsPanel tagLabel="To Do" entries={entries} onSelect={onSelect} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("Call Alex"));
    expect(onSelect).toHaveBeenCalledWith(entries[1]);
  });

  it("shows a placeholder for an entry whose text is blank", () => {
    const blank: TaggedParagraphEntry[] = [
      { id: "p3:o3", pageId: "p3", pageTitle: "Empty Page", objectId: "o3", text: "   " },
    ];
    render(
      <ThemeProvider>
        <TaggedParagraphsPanel tagLabel="To Do" entries={blank} onSelect={noop} />
      </ThemeProvider>,
    );

    expect(screen.getByText("(empty)")).toBeInTheDocument();
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <TaggedParagraphsPanel tagLabel="To Do" entries={entries} onSelect={noop} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("region", { name: '"To Do" lines' })).toBeInTheDocument();
  });
});
