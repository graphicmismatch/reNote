import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider/ThemeProvider.js";
import { CommandPalette, type CommandPaletteItem } from "./CommandPalette.js";

const items: CommandPaletteItem[] = [
  { id: "c1", label: "Undo", shortcut: "Mod+Z" },
  { id: "c2", label: "Redo", shortcut: "Mod+Shift+Z" },
  { id: "c3", label: "New Page", shortcut: null },
];

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ThemeProvider>
        <CommandPalette
          open={false}
          query=""
          items={items}
          onQueryChange={() => {}}
          onExecute={() => {}}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the query input, item labels and shortcuts when open", () => {
    render(
      <ThemeProvider>
        <CommandPalette
          open
          query="un"
          items={items}
          onQueryChange={() => {}}
          onExecute={() => {}}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole("dialog", { name: "Command Palette" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Command" })).toHaveValue("un");
    expect(screen.getByText("Undo")).toBeInTheDocument();
    expect(screen.getByText("Mod+Z")).toBeInTheDocument();
    expect(screen.getByText("Redo")).toBeInTheDocument();
    expect(screen.getByText("New Page")).toBeInTheDocument();
  });

  it("fires onQueryChange when typing into the input", () => {
    const onQueryChange = vi.fn();
    render(
      <ThemeProvider>
        <CommandPalette
          open
          query=""
          items={items}
          onQueryChange={onQueryChange}
          onExecute={() => {}}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Command" }), { target: { value: "und" } });
    expect(onQueryChange).toHaveBeenCalledWith("und");
  });

  it("calls onExecute when clicking an item", () => {
    const onExecute = vi.fn();
    render(
      <ThemeProvider>
        <CommandPalette
          open
          query=""
          items={items}
          onQueryChange={() => {}}
          onExecute={onExecute}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("Redo"));
    expect(onExecute).toHaveBeenCalledWith("c2");
  });

  it("calls onClose when clicking the backdrop, but not when clicking the panel", () => {
    const onClose = vi.fn();
    render(
      <ThemeProvider>
        <CommandPalette
          open
          query=""
          items={items}
          onQueryChange={() => {}}
          onExecute={() => {}}
          onClose={onClose}
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
        <CommandPalette
          open
          query=""
          items={items}
          onQueryChange={() => {}}
          onExecute={() => {}}
          onClose={onClose}
        />
      </ThemeProvider>,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Command" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ArrowDown/ArrowUp move the highlighted item and Enter executes it", () => {
    const onExecute = vi.fn();
    render(
      <ThemeProvider>
        <CommandPalette
          open
          query=""
          items={items}
          onQueryChange={() => {}}
          onExecute={onExecute}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    const input = screen.getByRole("textbox", { name: "Command" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onExecute).toHaveBeenCalledWith("c2");
  });

  it("Enter with no ArrowDown executes the first item", () => {
    const onExecute = vi.fn();
    render(
      <ThemeProvider>
        <CommandPalette
          open
          query=""
          items={items}
          onQueryChange={() => {}}
          onExecute={onExecute}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Command" }), { key: "Enter" });
    expect(onExecute).toHaveBeenCalledWith("c1");
  });

  it("keeps the highlighted item stable when the caller re-renders with a new array of the same ids", () => {
    const onExecute = vi.fn();
    const { rerender } = render(
      <ThemeProvider>
        <CommandPalette
          open
          query=""
          items={items}
          onQueryChange={() => {}}
          onExecute={onExecute}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    const input = screen.getByRole("textbox", { name: "Command" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // highlighted index is now 2 ("New Page")

    // Simulate the caller re-filtering: a brand-new array instance with the
    // same item ids/content. This must NOT reset the highlight to 0.
    rerender(
      <ThemeProvider>
        <CommandPalette
          open
          query=""
          items={items.map((item) => ({ ...item }))}
          onQueryChange={() => {}}
          onExecute={onExecute}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Command" }), { key: "Enter" });
    expect(onExecute).toHaveBeenCalledWith("c3");
  });

  it("resets the highlighted item to the first entry when the item list actually changes", () => {
    const onExecute = vi.fn();
    const { rerender } = render(
      <ThemeProvider>
        <CommandPalette
          open
          query=""
          items={items}
          onQueryChange={() => {}}
          onExecute={onExecute}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    const input = screen.getByRole("textbox", { name: "Command" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // highlighted index is now 2 ("New Page")

    const filtered: CommandPaletteItem[] = [{ id: "c1", label: "Undo", shortcut: "Mod+Z" }];
    rerender(
      <ThemeProvider>
        <CommandPalette
          open
          query="undo"
          items={filtered}
          onQueryChange={() => {}}
          onExecute={onExecute}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Command" }), { key: "Enter" });
    expect(onExecute).toHaveBeenCalledWith("c1");
  });

  it("resets the highlighted item on reopen, even when it lands on the exact same item set as last time", () => {
    const onExecute = vi.fn();
    const { rerender } = render(
      <ThemeProvider>
        <CommandPalette
          open
          query=""
          items={items}
          onQueryChange={() => {}}
          onExecute={onExecute}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Command" }), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Command" }), { key: "ArrowDown" });
    // highlighted index is now 2 ("New Page")

    // Close, then reopen with the identical `items` array — same content, same reference even.
    // The component stays mounted throughout (it just renders null while closed), so without
    // `open` in the reset effect's deps, the stale highlight would silently survive the round trip.
    rerender(
      <ThemeProvider>
        <CommandPalette
          open={false}
          query=""
          items={items}
          onQueryChange={() => {}}
          onExecute={onExecute}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );
    rerender(
      <ThemeProvider>
        <CommandPalette
          open
          query=""
          items={items}
          onQueryChange={() => {}}
          onExecute={onExecute}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Command" }), { key: "Enter" });
    expect(onExecute).toHaveBeenCalledWith(items[0]!.id);
  });

  it('shows "No matching commands" when items is empty', () => {
    render(
      <ThemeProvider>
        <CommandPalette
          open
          query="zzz"
          items={[]}
          onQueryChange={() => {}}
          onExecute={() => {}}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("No matching commands")).toBeInTheDocument();
  });

  it.each(["light", "dark"] as const)("renders without throwing in %s mode", (mode) => {
    render(
      <ThemeProvider defaultMode={mode}>
        <CommandPalette
          open
          query=""
          items={items}
          onQueryChange={() => {}}
          onExecute={() => {}}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Command Palette" })).toBeInTheDocument();
  });
});
