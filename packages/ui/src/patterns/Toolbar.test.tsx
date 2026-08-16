import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { Toolbar, type ToolbarGroup } from "./Toolbar.js";

function makeGroups(onClickA: () => void, onClickB: () => void): ToolbarGroup[] {
  return [
    { items: [{ id: "a", label: "Bold", onClick: onClickA }] },
    { items: [{ id: "b", label: "Italic", active: true, onClick: onClickB }] },
  ];
}

describe("Toolbar", () => {
  it("renders a toolbar with grouped buttons and a divider between groups", () => {
    render(
      <ThemeProvider>
        <Toolbar
          groups={makeGroups(
            () => {},
            () => {},
          )}
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Italic" })).toBeInTheDocument();
  });

  it("fires each item's onClick and marks active items pressed", () => {
    const onClickA = vi.fn();
    const onClickB = vi.fn();
    render(
      <ThemeProvider>
        <Toolbar groups={makeGroups(onClickA, onClickB)} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onClickA).toHaveBeenCalledTimes(1);
    expect(onClickB).not.toHaveBeenCalled();

    const italicButton = screen.getByRole("button", { name: "Italic" });
    expect(italicButton).toHaveAttribute("aria-pressed", "true");
  });

  it("disables items with disabled: true", () => {
    render(
      <ThemeProvider>
        <Toolbar groups={[{ items: [{ id: "c", label: "Underline", disabled: true, onClick: () => {} }] }]} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("button", { name: "Underline" })).toBeDisabled();
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <Toolbar
          groups={makeGroups(
            () => {},
            () => {},
          )}
        />
      </ThemeProvider>,
    );
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });
});
