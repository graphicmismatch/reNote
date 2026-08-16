import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { SearchPanel, type SearchResultItem } from "./SearchPanel.js";

const results: SearchResultItem[] = [
  { id: "p1", title: "Meeting Notes", snippet: "…discussed the roadmap…" },
  { id: "p2", title: "Groceries", snippet: "…milk, eggs, bread…" },
];

describe("SearchPanel", () => {
  it("renders the search input and result titles/snippets", () => {
    render(
      <ThemeProvider>
        <SearchPanel query="meeting" results={results} onQueryChange={() => {}} onSelect={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("meeting");
    expect(screen.getByText("Meeting Notes")).toBeInTheDocument();
    expect(screen.getByText("…discussed the roadmap…")).toBeInTheDocument();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
  });

  it("fires onQueryChange when typing into the input", () => {
    const onQueryChange = vi.fn();
    render(
      <ThemeProvider>
        <SearchPanel query="" results={[]} onQueryChange={onQueryChange} onSelect={() => {}} />
      </ThemeProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "notes" } });
    expect(onQueryChange).toHaveBeenCalledWith("notes");
  });

  it("calls onSelect with the result's id when a row is clicked", () => {
    const onSelect = vi.fn();
    render(
      <ThemeProvider>
        <SearchPanel query="g" results={results} onQueryChange={() => {}} onSelect={onSelect} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("Groceries"));
    expect(onSelect).toHaveBeenCalledWith("p2");
  });

  it('shows "No results" when query is non-empty and results is empty', () => {
    render(
      <ThemeProvider>
        <SearchPanel query="nothing" results={[]} onQueryChange={() => {}} onSelect={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("does not show an empty-state message when query is empty", () => {
    render(
      <ThemeProvider>
        <SearchPanel query="" results={[]} onQueryChange={() => {}} onSelect={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.queryByText("No results")).not.toBeInTheDocument();
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <SearchPanel query="" results={results} onQueryChange={() => {}} onSelect={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("textbox", { name: "Search" })).toBeInTheDocument();
  });
});
