import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { ThemeToggle } from "./ThemeToggle.js";

describe("ThemeToggle", () => {
  it("reflects light mode as unchecked and shows the Light label", () => {
    render(
      <ThemeProvider>
        <ThemeToggle mode="light" onToggle={() => {}} />
      </ThemeProvider>,
    );

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveTextContent("Light");
  });

  it("reflects dark mode as checked and calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(
      <ThemeProvider>
        <ThemeToggle mode="dark" onToggle={onToggle} />
      </ThemeProvider>,
    );

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveTextContent("Dark");

    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <ThemeToggle mode={mode} onToggle={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });
});
