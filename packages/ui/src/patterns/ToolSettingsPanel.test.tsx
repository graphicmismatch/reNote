import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { ToolSettingsPanel } from "./ToolSettingsPanel.js";

describe("ToolSettingsPanel", () => {
  it("renders the color section and custom color swatch when color is a hex string", () => {
    const { container } = render(
      <ThemeProvider>
        <ToolSettingsPanel
          toolLabel="Pen"
          color="#000000"
          onColorChange={() => {}}
          width={4}
          minWidth={1}
          maxWidth={20}
          onWidthChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(container.querySelector(".renote-tool-settings-color-section")).toBeInTheDocument();
    expect(screen.getByLabelText("Custom color")).toBeInTheDocument();
  });

  it("omits the color section entirely when color is null", () => {
    const { container } = render(
      <ThemeProvider>
        <ToolSettingsPanel
          toolLabel="Pixel Eraser"
          color={null}
          onColorChange={() => {}}
          width={10}
          minWidth={1}
          maxWidth={40}
          onWidthChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(container.querySelector(".renote-tool-settings-color-section")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Custom color")).not.toBeInTheDocument();
  });

  it("calls onColorChange with the preset's exact hex value when a swatch is clicked", () => {
    const onColorChange = vi.fn();
    render(
      <ThemeProvider>
        <ToolSettingsPanel
          toolLabel="Pen"
          color="#000000"
          onColorChange={onColorChange}
          width={4}
          minWidth={1}
          maxWidth={20}
          onWidthChange={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByLabelText("Set color to #1e5fd9"));
    expect(onColorChange).toHaveBeenCalledWith("#1e5fd9");
  });

  it("marks the swatch matching the current color as selected", () => {
    render(
      <ThemeProvider>
        <ToolSettingsPanel
          toolLabel="Pen"
          color="#1b7a3d"
          onColorChange={() => {}}
          width={4}
          minWidth={1}
          maxWidth={20}
          onWidthChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText("Set color to #1b7a3d")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Set color to #1b7a3d")).toHaveClass("renote-tool-settings-swatch-selected");
    expect(screen.getByLabelText("Set color to #000000")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Set color to #000000")).not.toHaveClass(
      "renote-tool-settings-swatch-selected",
    );
    expect(screen.getByLabelText("Custom color")).not.toHaveClass("renote-tool-settings-swatch-selected");
  });

  it("bounds the width slider to [minWidth, maxWidth] and fires onWidthChange continuously when moved", () => {
    const onWidthChange = vi.fn();
    render(
      <ThemeProvider>
        <ToolSettingsPanel
          toolLabel="Highlighter"
          color="#000000"
          onColorChange={() => {}}
          width={5}
          minWidth={2}
          maxWidth={30}
          onWidthChange={onWidthChange}
        />
      </ThemeProvider>,
    );

    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("min", "2");
    expect(slider).toHaveAttribute("max", "30");

    // Fires on `input` (continuous drag), not only on `change` (release) — mirrors Minimap's
    // "live radar control" requirement of firing during the gesture, not just after it.
    fireEvent.input(slider, { target: { value: "15" } });
    expect(onWidthChange).toHaveBeenCalledWith(15);

    fireEvent.change(slider, { target: { value: "22" } });
    expect(onWidthChange).toHaveBeenCalledWith(22);
    expect(onWidthChange).toHaveBeenCalledTimes(2);
  });

  it("clamps a width prop outside [minWidth, maxWidth] instead of crashing or exceeding the bound", () => {
    render(
      <ThemeProvider>
        <ToolSettingsPanel
          toolLabel="Pen"
          color="#000000"
          onColorChange={() => {}}
          width={999}
          minWidth={1}
          maxWidth={30}
          onWidthChange={() => {}}
        />
      </ThemeProvider>,
    );

    const slider = screen.getByRole("slider");
    expect(slider).toHaveValue("30");
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("reflects the color prop in the custom color input's value and fires onColorChange when changed", () => {
    const onColorChange = vi.fn();
    render(
      <ThemeProvider>
        <ToolSettingsPanel
          toolLabel="Pen"
          color="#123456"
          onColorChange={onColorChange}
          width={4}
          minWidth={1}
          maxWidth={20}
          onWidthChange={() => {}}
        />
      </ThemeProvider>,
    );

    const customInput = screen.getByLabelText("Custom color") as HTMLInputElement;
    expect(customInput.value).toBe("#123456");

    fireEvent.change(customInput, { target: { value: "#abcdef" } });
    expect(onColorChange).toHaveBeenCalledWith("#abcdef");
  });

  it("marks the custom color input as selected when color matches no preset", () => {
    render(
      <ThemeProvider>
        <ToolSettingsPanel
          toolLabel="Pen"
          color="#123456"
          onColorChange={() => {}}
          width={4}
          minWidth={1}
          maxWidth={20}
          onWidthChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText("Custom color")).toHaveClass("renote-tool-settings-swatch-selected");
  });

  it("renders without throwing for a colorless tool (eraser) with a plausible width", () => {
    render(
      <ThemeProvider>
        <ToolSettingsPanel
          toolLabel="Pixel Eraser"
          color={null}
          onColorChange={() => {}}
          width={12}
          minWidth={4}
          maxWidth={40}
          onWidthChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole("region", { name: "Pixel Eraser" })).toBeInTheDocument();
  });

  it("renders without throwing for a tool with color (pen) with a plausible width", () => {
    render(
      <ThemeProvider>
        <ToolSettingsPanel
          toolLabel="Pen"
          color="#000000"
          onColorChange={() => {}}
          width={4}
          minWidth={1}
          maxWidth={20}
          onWidthChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole("region", { name: "Pen" })).toBeInTheDocument();
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <ToolSettingsPanel
          toolLabel="Pen"
          color="#000000"
          onColorChange={() => {}}
          width={4}
          minWidth={1}
          maxWidth={20}
          onWidthChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole("region", { name: "Pen" })).toBeInTheDocument();
  });
});
