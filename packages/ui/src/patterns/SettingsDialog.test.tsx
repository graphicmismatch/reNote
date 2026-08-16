import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { SettingsDialog, type PointerSourceOverrideSettings } from "./SettingsDialog.js";

const noopOverrides: PointerSourceOverrideSettings = {};

describe("SettingsDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ThemeProvider>
        <SettingsDialog
          open={false}
          onClose={() => {}}
          pointerSourceOverrides={noopOverrides}
          onPointerSourceOverrideChange={() => {}}
          autosaveIntervalSeconds={30}
          onAutosaveIntervalSecondsChange={() => {}}
          recognizeShapes={false}
          onRecognizeShapesChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the dialog with title "Settings" and "Pointer Input"/"Autosave" sections when open', () => {
    render(
      <ThemeProvider>
        <SettingsDialog
          open
          onClose={() => {}}
          pointerSourceOverrides={noopOverrides}
          onPointerSourceOverrideChange={() => {}}
          autosaveIntervalSeconds={30}
          onAutosaveIntervalSecondsChange={() => {}}
          recognizeShapes={false}
          onRecognizeShapesChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Pointer Input")).toBeInTheDocument();
    expect(screen.getByText("Autosave")).toBeInTheDocument();
    expect(screen.getByText("Drawing")).toBeInTheDocument();
  });

  it("reflects the current recognizeShapes value in the checkbox", () => {
    render(
      <ThemeProvider>
        <SettingsDialog
          open
          onClose={() => {}}
          pointerSourceOverrides={noopOverrides}
          onPointerSourceOverrideChange={() => {}}
          autosaveIntervalSeconds={30}
          onAutosaveIntervalSecondsChange={() => {}}
          recognizeShapes
          onRecognizeShapesChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText("Recognize shapes while drawing")).toBeChecked();
  });

  it("calls onRecognizeShapesChange with the checkbox's new state", () => {
    const onChange = vi.fn();
    render(
      <ThemeProvider>
        <SettingsDialog
          open
          onClose={() => {}}
          pointerSourceOverrides={noopOverrides}
          onPointerSourceOverrideChange={() => {}}
          autosaveIntervalSeconds={30}
          onAutosaveIntervalSecondsChange={() => {}}
          recognizeShapes={false}
          onRecognizeShapesChange={onChange}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByLabelText("Recognize shapes while drawing"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("each select defaults to Default when no override is set", () => {
    render(
      <ThemeProvider>
        <SettingsDialog
          open
          onClose={() => {}}
          pointerSourceOverrides={noopOverrides}
          onPointerSourceOverrideChange={() => {}}
          autosaveIntervalSeconds={30}
          onAutosaveIntervalSecondsChange={() => {}}
          recognizeShapes={false}
          onRecognizeShapesChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText("Mouse")).toHaveValue("");
    expect(screen.getByLabelText("Pen / Stylus")).toHaveValue("");
    expect(screen.getByLabelText("Touch")).toHaveValue("");
  });

  it("reflects a non-default override in the matching row's select", () => {
    render(
      <ThemeProvider>
        <SettingsDialog
          open
          onClose={() => {}}
          pointerSourceOverrides={{ mouse: "pen" }}
          onPointerSourceOverrideChange={() => {}}
          autosaveIntervalSeconds={30}
          onAutosaveIntervalSecondsChange={() => {}}
          recognizeShapes={false}
          onRecognizeShapesChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText("Mouse")).toHaveValue("pen");
    expect(screen.getByLabelText("Pen / Stylus")).toHaveValue("");
    expect(screen.getByLabelText("Touch")).toHaveValue("");
  });

  it("calls onPointerSourceOverrideChange with the source and chosen target", () => {
    const onChange = vi.fn();
    render(
      <ThemeProvider>
        <SettingsDialog
          open
          onClose={() => {}}
          pointerSourceOverrides={noopOverrides}
          onPointerSourceOverrideChange={onChange}
          autosaveIntervalSeconds={30}
          onAutosaveIntervalSecondsChange={() => {}}
          recognizeShapes={false}
          onRecognizeShapesChange={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.change(screen.getByLabelText("Touch"), { target: { value: "pen" } });
    expect(onChange).toHaveBeenCalledWith("touch", "pen");
  });

  it("calls onPointerSourceOverrideChange with null when choosing Default again", () => {
    const onChange = vi.fn();
    render(
      <ThemeProvider>
        <SettingsDialog
          open
          onClose={() => {}}
          pointerSourceOverrides={{ pen: "mouse" }}
          onPointerSourceOverrideChange={onChange}
          autosaveIntervalSeconds={30}
          onAutosaveIntervalSecondsChange={() => {}}
          recognizeShapes={false}
          onRecognizeShapesChange={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.change(screen.getByLabelText("Pen / Stylus"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("pen", null);
  });

  it("reflects the current autosave interval in the number input", () => {
    render(
      <ThemeProvider>
        <SettingsDialog
          open
          onClose={() => {}}
          pointerSourceOverrides={noopOverrides}
          onPointerSourceOverrideChange={() => {}}
          autosaveIntervalSeconds={45}
          onAutosaveIntervalSecondsChange={() => {}}
          recognizeShapes={false}
          onRecognizeShapesChange={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText("Autosave every (seconds)")).toHaveValue(45);
  });

  it("calls onAutosaveIntervalSecondsChange with the parsed number when edited", () => {
    const onChange = vi.fn();
    render(
      <ThemeProvider>
        <SettingsDialog
          open
          onClose={() => {}}
          pointerSourceOverrides={noopOverrides}
          onPointerSourceOverrideChange={() => {}}
          autosaveIntervalSeconds={30}
          onAutosaveIntervalSecondsChange={onChange}
          recognizeShapes={false}
          onRecognizeShapesChange={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.change(screen.getByLabelText("Autosave every (seconds)"), { target: { value: "60" } });
    expect(onChange).toHaveBeenCalledWith(60);
  });

  it("calls onAutosaveIntervalSecondsChange with 0 for a 0 value (autosave off)", () => {
    const onChange = vi.fn();
    render(
      <ThemeProvider>
        <SettingsDialog
          open
          onClose={() => {}}
          pointerSourceOverrides={noopOverrides}
          onPointerSourceOverrideChange={() => {}}
          autosaveIntervalSeconds={30}
          onAutosaveIntervalSecondsChange={onChange}
          recognizeShapes={false}
          onRecognizeShapesChange={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.change(screen.getByLabelText("Autosave every (seconds)"), { target: { value: "0" } });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("calls onClose when clicking the backdrop, but not when clicking the panel", () => {
    const onClose = vi.fn();
    render(
      <ThemeProvider>
        <SettingsDialog
          open
          onClose={onClose}
          pointerSourceOverrides={noopOverrides}
          onPointerSourceOverrideChange={() => {}}
          autosaveIntervalSeconds={30}
          onAutosaveIntervalSecondsChange={() => {}}
          recognizeShapes={false}
          onRecognizeShapesChange={() => {}}
        />
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
        <SettingsDialog
          open
          onClose={onClose}
          pointerSourceOverrides={noopOverrides}
          onPointerSourceOverrideChange={() => {}}
          autosaveIntervalSeconds={30}
          onAutosaveIntervalSecondsChange={() => {}}
          recognizeShapes={false}
          onRecognizeShapesChange={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <SettingsDialog
          open
          onClose={() => {}}
          pointerSourceOverrides={noopOverrides}
          onPointerSourceOverrideChange={() => {}}
          autosaveIntervalSeconds={30}
          onAutosaveIntervalSecondsChange={() => {}}
          recognizeShapes={false}
          onRecognizeShapesChange={() => {}}
        />
      </ThemeProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });
});
