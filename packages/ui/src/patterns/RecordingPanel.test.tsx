import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { RecordingPanel } from "./RecordingPanel.js";

describe("RecordingPanel", () => {
  it("formats elapsed seconds as m:ss", () => {
    render(
      <ThemeProvider>
        <RecordingPanel elapsedSeconds={65} onStop={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByText("Recording… 1:05")).toBeInTheDocument();
  });

  it("calls onStop when the Stop button is clicked", () => {
    const onStop = vi.fn();
    render(
      <ThemeProvider>
        <RecordingPanel elapsedSeconds={3} onStop={onStop} />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText("Stop"));
    expect(onStop).toHaveBeenCalledOnce();
  });
});
