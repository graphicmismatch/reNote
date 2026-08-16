import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { Minimap, type MinimapRect } from "./Minimap.js";

const viewport: MinimapRect = { x: 0, y: 0, width: 800, height: 600 };
const content: MinimapRect = { x: -500, y: -500, width: 1000, height: 1000 };

function getBox(container: HTMLElement): HTMLElement {
  const box = container.querySelector(".renote-minimap-box");
  if (!box) throw new Error("minimap box not found");
  return box as HTMLElement;
}

function assertNoNaNInStyle(element: Element | null) {
  if (!element) return;
  const style = (element as HTMLElement).style;
  for (const prop of ["left", "top", "width", "height"]) {
    const value = style.getPropertyValue(prop);
    expect(value).not.toMatch(/NaN|Infinity/);
  }
}

describe("Minimap", () => {
  it("renders without crashing given contentBounds: null and a plausible viewportRect", () => {
    render(
      <ThemeProvider>
        <Minimap contentBounds={null} viewportRect={viewport} onNavigate={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByRole("region", { name: "Minimap" })).toBeInTheDocument();
    const { container } = render(
      <ThemeProvider>
        <Minimap contentBounds={null} viewportRect={viewport} onNavigate={() => {}} />
      </ThemeProvider>,
    );
    expect(container.querySelector(".renote-minimap-viewport-rect")).toBeInTheDocument();
    expect(container.querySelector(".renote-minimap-content-rect")).not.toBeInTheDocument();
  });

  it("renders both content and viewport rects distinguishably when both are non-null/valid", () => {
    const { container } = render(
      <ThemeProvider>
        <Minimap contentBounds={content} viewportRect={viewport} onNavigate={() => {}} />
      </ThemeProvider>,
    );

    const contentRect = container.querySelector(".renote-minimap-content-rect");
    const viewportRectEl = container.querySelector(".renote-minimap-viewport-rect");
    expect(contentRect).toBeInTheDocument();
    expect(viewportRectEl).toBeInTheDocument();
    expect(contentRect).not.toHaveClass("renote-minimap-viewport-rect");
    expect(viewportRectEl).not.toHaveClass("renote-minimap-content-rect");
  });

  it("calls onNavigate with world coordinates that scale sanely with click position", () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <Minimap
          contentBounds={{ x: 0, y: 0, width: 1000, height: 1000 }}
          viewportRect={{ x: 0, y: 0, width: 1000, height: 1000 }}
          onNavigate={onNavigate}
        />
      </ThemeProvider>,
    );
    const box = getBox(container);

    fireEvent.mouseDown(box, { clientX: 5, clientY: 5 });
    const [topLeftX, topLeftY] = onNavigate.mock.calls[0]!;
    fireEvent.mouseUp(window);

    onNavigate.mockClear();
    fireEvent.mouseDown(box, { clientX: 195, clientY: 135 });
    const [bottomRightX, bottomRightY] = onNavigate.mock.calls[0]!;
    fireEvent.mouseUp(window);

    expect(topLeftX).toBeLessThan(bottomRightX);
    expect(topLeftY).toBeLessThan(bottomRightY);
  });

  it("fires onNavigate continuously while dragging, not just once on click", () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <Minimap contentBounds={content} viewportRect={viewport} onNavigate={onNavigate} />
      </ThemeProvider>,
    );
    const box = getBox(container);

    fireEvent.mouseDown(box, { clientX: 20, clientY: 20 });
    expect(onNavigate).toHaveBeenCalledTimes(1);

    fireEvent.mouseMove(window, { clientX: 60, clientY: 60 });
    expect(onNavigate).toHaveBeenCalledTimes(2);

    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
    // No further calls once the drag has ended.
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it("handles degenerate zero-size viewportRect without NaN/Infinity in any inline style", () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <Minimap
          contentBounds={null}
          viewportRect={{ x: 42, y: 42, width: 0, height: 0 }}
          onNavigate={onNavigate}
        />
      </ThemeProvider>,
    );

    const viewportRectEl = container.querySelector(".renote-minimap-viewport-rect");
    expect(viewportRectEl).toBeInTheDocument();
    assertNoNaNInStyle(viewportRectEl);

    const box = getBox(container);
    fireEvent.mouseDown(box, { clientX: 50, clientY: 50 });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    const [worldX, worldY] = onNavigate.mock.calls[0]!;
    expect(Number.isFinite(worldX)).toBe(true);
    expect(Number.isFinite(worldY)).toBe(true);
  });

  it("handles a single-point contentBounds without NaN/Infinity in any inline style", () => {
    const { container } = render(
      <ThemeProvider>
        <Minimap
          contentBounds={{ x: 10, y: 10, width: 0, height: 0 }}
          viewportRect={viewport}
          onNavigate={() => {}}
        />
      </ThemeProvider>,
    );

    assertNoNaNInStyle(container.querySelector(".renote-minimap-content-rect"));
    assertNoNaNInStyle(container.querySelector(".renote-minimap-viewport-rect"));
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <Minimap contentBounds={content} viewportRect={viewport} onNavigate={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("region", { name: "Minimap" })).toBeInTheDocument();
  });
});
