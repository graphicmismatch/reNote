import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { AutosavePanel, type AutosaveEntry } from "./AutosavePanel.js";

const entry: AutosaveEntry = { timestamp: "2026-01-02T12:30:00.000Z", sizeBytes: 2048, objectCount: 3 };

describe("AutosavePanel", () => {
  it("renders an Autosave panel with the entry's object count and size", () => {
    render(
      <ThemeProvider>
        <AutosavePanel entry={entry} onRestore={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("region", { name: "Autosave" })).toBeInTheDocument();
    expect(screen.getByText(/3 objects ·/)).toBeInTheDocument();
  });

  it('shows "No autosave yet" when entry is null', () => {
    render(
      <ThemeProvider>
        <AutosavePanel entry={null} onRestore={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByText("No autosave yet")).toBeInTheDocument();
  });

  it("does not render a Restore button when entry is null", () => {
    render(
      <ThemeProvider>
        <AutosavePanel entry={null} onRestore={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.queryByText("Restore Autosave")).not.toBeInTheDocument();
  });

  it("calls onRestore when the Restore Autosave button is clicked", () => {
    const onRestore = vi.fn();
    render(
      <ThemeProvider>
        <AutosavePanel entry={entry} onRestore={onRestore} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("Restore Autosave"));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("formats a singular object count without a trailing s", () => {
    render(
      <ThemeProvider>
        <AutosavePanel entry={{ ...entry, objectCount: 1 }} onRestore={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByText(/1 object ·/)).toBeInTheDocument();
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <AutosavePanel entry={entry} onRestore={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("region", { name: "Autosave" })).toBeInTheDocument();
  });
});
