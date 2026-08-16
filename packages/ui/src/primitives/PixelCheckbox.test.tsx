import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { PixelCheckbox } from "./PixelCheckbox.js";

describe("PixelCheckbox", () => {
  it("renders the unchecked glyph and toggles on click", () => {
    const handleChange = vi.fn();
    render(
      <ThemeProvider>
        <PixelCheckbox checked={false} onChange={handleChange} label="To do" />
      </ThemeProvider>,
    );

    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByRole("checkbox"));

    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it("renders the checked glyph when checked is true", () => {
    render(
      <ThemeProvider>
        <PixelCheckbox checked onChange={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  });
});
