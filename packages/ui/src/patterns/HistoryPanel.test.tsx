import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { HistoryPanel, type HistoryEntry } from "./HistoryPanel.js";

const entries: HistoryEntry[] = [
  { id: "h1", label: "Add stroke" },
  { id: "h2", label: "Move object" },
];

describe("HistoryPanel", () => {
  it("renders a History panel with a synthetic start row plus all entries", () => {
    render(
      <ThemeProvider>
        <HistoryPanel entries={entries} pointerIndex={0} onJumpTo={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("region", { name: "History" })).toBeInTheDocument();
    expect(screen.getByText("(start)")).toBeInTheDocument();
    expect(screen.getByText("Add stroke")).toBeInTheDocument();
    expect(screen.getByText("Move object")).toBeInTheDocument();
  });

  it("marks entries at or before pointerIndex as applied and later ones as undone", () => {
    render(
      <ThemeProvider>
        <HistoryPanel entries={entries} pointerIndex={0} onJumpTo={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByText("Add stroke")).toHaveClass("renote-history-panel-entry-applied");
    expect(screen.getByText("Move object")).toHaveClass("renote-history-panel-entry-undone");
    expect(screen.getByText("(start)")).toHaveClass("renote-history-panel-entry-undone");
  });

  it("calls onJumpTo with the clicked entry's index, and -1 for the start row", () => {
    const onJumpTo = vi.fn();
    render(
      <ThemeProvider>
        <HistoryPanel entries={entries} pointerIndex={1} onJumpTo={onJumpTo} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("Add stroke"));
    expect(onJumpTo).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByText("(start)"));
    expect(onJumpTo).toHaveBeenCalledWith(-1);
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <HistoryPanel entries={entries} pointerIndex={-1} onJumpTo={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByText("(start)")).toHaveClass("renote-history-panel-entry-applied");
  });
});
