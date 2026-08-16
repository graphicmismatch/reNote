import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { RelatedNotesPanel, type RelatedNoteEntry } from "./RelatedNotesPanel.js";

const entries: RelatedNoteEntry[] = [
  { id: "page-1", title: "Rocket Engines" },
  { id: "page-2", title: "Propellant Chemistry" },
];

function noop() {}

describe("RelatedNotesPanel", () => {
  it("renders a Related Notes panel listing each entry's title", () => {
    render(
      <ThemeProvider>
        <RelatedNotesPanel entries={entries} onSelect={noop} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("region", { name: "Related Notes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rocket Engines" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Propellant Chemistry" })).toBeInTheDocument();
  });

  it('shows "No related notes" when entries is empty', () => {
    render(
      <ThemeProvider>
        <RelatedNotesPanel entries={[]} onSelect={noop} />
      </ThemeProvider>,
    );

    expect(screen.getByText("No related notes")).toBeInTheDocument();
  });

  it("calls onSelect with the entry's page id when its row is clicked", () => {
    const onSelect = vi.fn();
    render(
      <ThemeProvider>
        <RelatedNotesPanel entries={entries} onSelect={onSelect} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Propellant Chemistry" }));
    expect(onSelect).toHaveBeenCalledWith("page-2");
  });
});
