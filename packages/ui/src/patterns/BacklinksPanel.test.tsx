import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { BacklinksPanel, type BacklinkEntry } from "./BacklinksPanel.js";

const entries: BacklinkEntry[] = [
  { id: "page-1", title: "Recipes" },
  { id: "page-2", title: "Groceries" },
];

function noop() {}

describe("BacklinksPanel", () => {
  it("renders a Linked Mentions panel listing each entry's title", () => {
    render(
      <ThemeProvider>
        <BacklinksPanel entries={entries} onSelect={noop} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("region", { name: "Linked Mentions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recipes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Groceries" })).toBeInTheDocument();
  });

  it('shows "No linked mentions" when entries is empty', () => {
    render(
      <ThemeProvider>
        <BacklinksPanel entries={[]} onSelect={noop} />
      </ThemeProvider>,
    );

    expect(screen.getByText("No linked mentions")).toBeInTheDocument();
  });

  it("calls onSelect with the entry's page id when its row is clicked", () => {
    const onSelect = vi.fn();
    render(
      <ThemeProvider>
        <BacklinksPanel entries={entries} onSelect={onSelect} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Groceries" }));
    expect(onSelect).toHaveBeenCalledWith("page-2");
  });

  it("renders an entry pointing back at the page currently open (a self-link) like any other", () => {
    const selfLinkEntries: BacklinkEntry[] = [{ id: "page-1", title: "Recipes" }];
    const onSelect = vi.fn();
    render(
      <ThemeProvider>
        <BacklinksPanel entries={selfLinkEntries} onSelect={onSelect} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Recipes" }));
    expect(onSelect).toHaveBeenCalledWith("page-1");
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <BacklinksPanel entries={entries} onSelect={noop} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("region", { name: "Linked Mentions" })).toBeInTheDocument();
  });
});
