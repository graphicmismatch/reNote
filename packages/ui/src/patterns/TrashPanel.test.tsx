import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { TrashPanel, type TrashEntry } from "./TrashPanel.js";

const entries: TrashEntry[] = [
  { id: "t1", kind: "page", name: "Meeting Notes", deletedAt: "2026-01-01T10:00:00.000Z" },
  { id: "t2", kind: "notebook", name: "Old Notebook", deletedAt: "2026-01-02T12:30:00.000Z" },
];

describe("TrashPanel", () => {
  it("renders a Trash panel with entry names and human-readable kinds", () => {
    render(
      <ThemeProvider>
        <TrashPanel entries={entries} onRestore={() => {}} onEmptyEntry={() => {}} onEmptyAll={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("region", { name: "Trash" })).toBeInTheDocument();
    expect(screen.getByText("Meeting Notes")).toBeInTheDocument();
    expect(screen.getByText("Old Notebook")).toBeInTheDocument();
    expect(screen.getByText(/^Page ·/)).toBeInTheDocument();
    expect(screen.getByText(/^Notebook ·/)).toBeInTheDocument();
  });

  it('shows "Trash is empty" when entries is empty', () => {
    render(
      <ThemeProvider>
        <TrashPanel entries={[]} onRestore={() => {}} onEmptyEntry={() => {}} onEmptyAll={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByText("Trash is empty")).toBeInTheDocument();
  });

  it("calls onRestore with the entry's id when its Restore button is clicked", () => {
    const onRestore = vi.fn();
    render(
      <ThemeProvider>
        <TrashPanel entries={entries} onRestore={onRestore} onEmptyEntry={() => {}} onEmptyAll={() => {}} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getAllByText("Restore")[0]!);
    expect(onRestore).toHaveBeenCalledWith("t1");
  });

  it("calls onEmptyEntry with the entry's id when its Delete Permanently button is clicked", () => {
    const onEmptyEntry = vi.fn();
    render(
      <ThemeProvider>
        <TrashPanel
          entries={entries}
          onRestore={() => {}}
          onEmptyEntry={onEmptyEntry}
          onEmptyAll={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getAllByText("Delete Permanently")[1]!);
    expect(onEmptyEntry).toHaveBeenCalledWith("t2");
  });

  it("calls onEmptyAll when the Empty Trash button is clicked", () => {
    const onEmptyAll = vi.fn();
    render(
      <ThemeProvider>
        <TrashPanel entries={entries} onRestore={() => {}} onEmptyEntry={() => {}} onEmptyAll={onEmptyAll} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("Empty Trash"));
    expect(onEmptyAll).toHaveBeenCalledTimes(1);
  });

  it("disables the Empty Trash button when there are no entries", () => {
    render(
      <ThemeProvider>
        <TrashPanel entries={[]} onRestore={() => {}} onEmptyEntry={() => {}} onEmptyAll={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByText("Empty Trash")).toBeDisabled();
  });

  it("does not disable the Empty Trash button when there are entries", () => {
    render(
      <ThemeProvider>
        <TrashPanel entries={entries} onRestore={() => {}} onEmptyEntry={() => {}} onEmptyAll={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByText("Empty Trash")).not.toBeDisabled();
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <TrashPanel entries={entries} onRestore={() => {}} onEmptyEntry={() => {}} onEmptyAll={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("region", { name: "Trash" })).toBeInTheDocument();
  });
});
