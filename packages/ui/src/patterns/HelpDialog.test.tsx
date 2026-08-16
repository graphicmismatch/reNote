import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { HelpDialog } from "./HelpDialog.js";

describe("HelpDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ThemeProvider>
        <HelpDialog open={false} onClose={() => {}} />
      </ThemeProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders every help section when open", () => {
    render(
      <ThemeProvider>
        <HelpDialog open onClose={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("dialog", { name: "Help" })).toBeInTheDocument();
    for (const title of [
      "Notebooks, sections, pages",
      "Drawing",
      "Text",
      "Tags",
      "Links",
      "Undo and safety",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("closes on Escape and on the Close button", () => {
    const onClose = vi.fn();
    render(
      <ThemeProvider>
        <HelpDialog open onClose={onClose} />
      </ThemeProvider>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
