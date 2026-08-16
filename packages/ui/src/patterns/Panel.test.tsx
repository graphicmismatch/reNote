import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { Panel } from "./Panel.js";

describe("Panel", () => {
  it("renders the title and children content", () => {
    render(
      <ThemeProvider>
        <Panel title="Notebooks">
          <p>Panel body content</p>
        </Panel>
      </ThemeProvider>,
    );

    expect(screen.getByRole("region", { name: "Notebooks" })).toBeInTheDocument();
    expect(screen.getByText("Panel body content")).toBeInTheDocument();
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <Panel title="History">
          <span>content</span>
        </Panel>
      </ThemeProvider>,
    );
    expect(screen.getByRole("region", { name: "History" })).toBeInTheDocument();
  });
});
