import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { PageBackgroundPanel, type PageBackgroundValue } from "./PageBackgroundPanel.js";

const defaultBackground: PageBackgroundValue = { color: null, ruleLines: "none" };

describe("PageBackgroundPanel", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ThemeProvider>
        <PageBackgroundPanel
          open={false}
          onClose={() => {}}
          background={defaultBackground}
          onChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the dialog with title "Page Background" when open', () => {
    render(
      <ThemeProvider>
        <PageBackgroundPanel open onClose={() => {}} background={defaultBackground} onChange={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("dialog", { name: "Page Background" })).toBeInTheDocument();
    expect(screen.getByText("Paper Color")).toBeInTheDocument();
    expect(screen.getByText("Rule Lines")).toBeInTheDocument();
  });

  it("reflects the current ruleLines value in the select", () => {
    render(
      <ThemeProvider>
        <PageBackgroundPanel
          open
          onClose={() => {}}
          background={{ color: null, ruleLines: "graph" }}
          onChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText("Style")).toHaveValue("graph");
  });

  it("calls onChange with the new ruleLines when the select changes", () => {
    const onChange = vi.fn();
    render(
      <ThemeProvider>
        <PageBackgroundPanel open onClose={() => {}} background={defaultBackground} onChange={onChange} />
      </ThemeProvider>,
    );

    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "dotted" } });
    expect(onChange).toHaveBeenCalledWith({ color: null, ruleLines: "dotted" });
  });

  it("calls onChange with the picked preset color, leaving ruleLines untouched", () => {
    const onChange = vi.fn();
    render(
      <ThemeProvider>
        <PageBackgroundPanel
          open
          onClose={() => {}}
          background={{ color: null, ruleLines: "wide-ruled" }}
          onChange={onChange}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByLabelText("Set paper color to #1e1e1e"));
    expect(onChange).toHaveBeenCalledWith({ color: "#1e1e1e", ruleLines: "wide-ruled" });
  });

  it('marks the "Default" button as pressed when color is null', () => {
    render(
      <ThemeProvider>
        <PageBackgroundPanel open onClose={() => {}} background={defaultBackground} onChange={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("button", { name: "Default" })).toHaveAttribute("aria-pressed", "true");
  });

  it('calls onChange with color: null when clicking "Default"', () => {
    const onChange = vi.fn();
    render(
      <ThemeProvider>
        <PageBackgroundPanel
          open
          onClose={() => {}}
          background={{ color: "#0b1d33", ruleLines: "none" }}
          onChange={onChange}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Default" }));
    expect(onChange).toHaveBeenCalledWith({ color: null, ruleLines: "none" });
  });

  it("calls onClose when clicking the backdrop, but not when clicking the panel", () => {
    const onClose = vi.fn();
    render(
      <ThemeProvider>
        <PageBackgroundPanel open onClose={onClose} background={defaultBackground} onChange={() => {}} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape calls onClose", () => {
    const onClose = vi.fn();
    render(
      <ThemeProvider>
        <PageBackgroundPanel open onClose={onClose} background={defaultBackground} onChange={() => {}} />
      </ThemeProvider>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <PageBackgroundPanel open onClose={() => {}} background={defaultBackground} onChange={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Page Background" })).toBeInTheDocument();
  });
});
