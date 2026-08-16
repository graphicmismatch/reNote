import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { WorkspacePicker } from "./WorkspacePicker.js";

describe("WorkspacePicker", () => {
  it('renders the dialog with title "Welcome to reNote" and a "Choose Workspace Folder..." button', () => {
    render(
      <ThemeProvider>
        <WorkspacePicker onChooseFolder={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("dialog", { name: "Choose Workspace" })).toBeInTheDocument();
    expect(screen.getByText("Welcome to reNote")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose Workspace Folder..." })).toBeInTheDocument();
  });

  it("calls onChooseFolder when the button is clicked", () => {
    const onChooseFolder = vi.fn();
    render(
      <ThemeProvider>
        <WorkspacePicker onChooseFolder={onChooseFolder} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose Workspace Folder..." }));
    expect(onChooseFolder).toHaveBeenCalledTimes(1);
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <WorkspacePicker onChooseFolder={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Choose Workspace" })).toBeInTheDocument();
  });
});
