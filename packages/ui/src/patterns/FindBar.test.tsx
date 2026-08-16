import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { FindBar } from "./FindBar.js";

describe("FindBar", () => {
  it("renders the query and a 1-based match count out of the total", () => {
    render(
      <ThemeProvider>
        <FindBar
          query="meeting"
          matchCount={3}
          currentIndex={1}
          onQueryChange={() => {}}
          onNext={() => {}}
          onPrevious={() => {}}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText("Find in page")).toHaveValue("meeting");
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it('shows "No results" and disables the step buttons when matchCount is 0', () => {
    render(
      <ThemeProvider>
        <FindBar
          query="xyz"
          matchCount={0}
          currentIndex={-1}
          onQueryChange={() => {}}
          onNext={() => {}}
          onPrevious={() => {}}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(screen.getByLabelText("Next match")).toBeDisabled();
    expect(screen.getByLabelText("Previous match")).toBeDisabled();
  });

  it("fires onQueryChange when typing", () => {
    const onQueryChange = vi.fn();
    render(
      <ThemeProvider>
        <FindBar
          query=""
          matchCount={0}
          currentIndex={-1}
          onQueryChange={onQueryChange}
          onNext={() => {}}
          onPrevious={() => {}}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.change(screen.getByLabelText("Find in page"), { target: { value: "notes" } });
    expect(onQueryChange).toHaveBeenCalledWith("notes");
  });

  it("Enter advances to the next match, Shift+Enter to the previous", () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    render(
      <ThemeProvider>
        <FindBar
          query="a"
          matchCount={2}
          currentIndex={0}
          onQueryChange={() => {}}
          onNext={onNext}
          onPrevious={onPrevious}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    const input = screen.getByLabelText("Find in page");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the bar", () => {
    const onClose = vi.fn();
    render(
      <ThemeProvider>
        <FindBar
          query=""
          matchCount={0}
          currentIndex={-1}
          onQueryChange={() => {}}
          onNext={() => {}}
          onPrevious={() => {}}
          onClose={onClose}
        />
      </ThemeProvider>,
    );

    fireEvent.keyDown(screen.getByLabelText("Find in page"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the close button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <ThemeProvider>
        <FindBar
          query=""
          matchCount={0}
          currentIndex={-1}
          onQueryChange={() => {}}
          onNext={() => {}}
          onPrevious={() => {}}
          onClose={onClose}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByLabelText("Close find bar"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <FindBar
          query=""
          matchCount={0}
          currentIndex={-1}
          onQueryChange={() => {}}
          onNext={() => {}}
          onPrevious={() => {}}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText("Find in page")).toBeInTheDocument();
  });
});
