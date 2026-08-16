import { describe, expect, it } from "vitest";
import {
  PointerInputDispatcher,
  type GlobalPointerEventTarget,
  type PointerInputHandlers,
  type PointerProjector,
} from "./pointer-input-dispatcher.js";

/**
 * A minimal DOM-element double: just enough `addEventListener`/
 * `getBoundingClientRect` surface for `PointerInputDispatcher`, with no real
 * DOM/jsdom dependency (this package deliberately stays headless-testable —
 * see `NullRenderer` elsewhere). `rect` is mutable so a test can simulate the
 * element being positioned away from the viewport's top-left corner.
 */
class FakeElement {
  rect = { left: 0, top: 0 };
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  // Third param mirrors DOM's addEventListener(type, handler, options) — the dispatcher
  // passes `{ passive: false }` for wheel; this double doesn't need to honor it, just accept it.
  addEventListener(type: string, handler: (event: unknown) => void, _options?: unknown): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  getBoundingClientRect() {
    return this.rect;
  }

  fire(type: string, event: unknown): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }
}

/**
 * A double for the `window` the dispatcher listens on for pointermove/pointerup/
 * pointercancel (see the constructor's doc comment for why those aren't scoped to the
 * canvas element). Separate from `FakeElement` since in real usage this is a genuinely
 * different object.
 */
class FakeWindow implements GlobalPointerEventTarget {
  private readonly listeners = new Map<string, Set<(event: PointerEvent) => void>>();

  addEventListener(type: string, handler: (event: PointerEvent) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: (event: PointerEvent) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  fire(type: string, event: unknown): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event as PointerEvent);
  }
}

function fakePointerEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    pointerId: 1,
    pointerType: "mouse",
    clientX: 0,
    clientY: 0,
    pressure: 0,
    tiltX: 0,
    tiltY: 0,
    button: 0,
    buttons: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    getCoalescedEvents: () => [],
    preventDefault: () => {},
    ...overrides,
  };
}

function fakeWheelEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    deltaX: 0,
    deltaY: 0,
    clientX: 0,
    clientY: 0,
    shiftKey: false,
    ctrlKey: false,
    preventDefault: () => {},
    ...overrides,
  };
}

/** All eight handlers stubbed no-op; individual tests override just the ones they assert on. */
function noopHandlers(overrides: Partial<PointerInputHandlers> = {}): PointerInputHandlers {
  return {
    onDown: () => {},
    onMove: () => {},
    onUp: () => {},
    onPanStart: () => {},
    onPanMove: () => {},
    onPanEnd: () => {},
    onWheelPan: () => {},
    onWheelZoom: () => {},
    ...overrides,
  };
}

describe("PointerInputDispatcher", () => {
  it("subtracts the element's on-page offset before projecting to world space", () => {
    const element = new FakeElement();
    element.rect = { left: 220, top: 60 }; // e.g. sidebar + toolbar pushing the canvas over
    const projections: Array<{ x: number; y: number }> = [];
    const projector: PointerProjector = {
      screenToWorld: (x, y) => {
        projections.push({ x, y });
        return { x, y };
      },
    };
    new PointerInputDispatcher(
      element as unknown as HTMLElement,
      projector,
      noopHandlers(),
      new FakeWindow(),
    );

    // clientX/clientY are viewport-relative; the dispatcher must convert them
    // to element-relative before calling screenToWorld.
    element.fire("pointerdown", fakePointerEvent({ clientX: 300, clientY: 150 }));

    expect(projections).toEqual([{ x: 80, y: 90 }]);
  });

  it("passes element-relative coordinates straight through when the element sits at the viewport origin", () => {
    const element = new FakeElement(); // rect defaults to {left: 0, top: 0}
    const projections: Array<{ x: number; y: number }> = [];
    const projector: PointerProjector = {
      screenToWorld: (x, y) => {
        projections.push({ x, y });
        return { x, y };
      },
    };
    new PointerInputDispatcher(
      element as unknown as HTMLElement,
      projector,
      noopHandlers(),
      new FakeWindow(),
    );

    element.fire("pointerdown", fakePointerEvent({ clientX: 42, clientY: 17 }));

    expect(projections).toEqual([{ x: 42, y: 17 }]);
  });

  it("also reports raw, un-projected screenX/screenY alongside the projected world x/y", () => {
    const element = new FakeElement();
    element.rect = { left: 220, top: 60 };
    const projector: PointerProjector = { screenToWorld: (x, y) => ({ x: x * 2, y: y * 2 }) };
    const downs: Array<{ x: number; y: number; screenX?: number; screenY?: number }> = [];
    new PointerInputDispatcher(
      element as unknown as HTMLElement,
      projector,
      noopHandlers({ onDown: (e) => downs.push(e) }),
      new FakeWindow(),
    );

    element.fire("pointerdown", fakePointerEvent({ clientX: 300, clientY: 150 }));

    // screenX/screenY are element-relative but NOT run through the (here, distorting)
    // projector, unlike x/y — panning needs the undistorted raw value.
    expect(downs).toEqual([expect.objectContaining({ x: 160, y: 180, screenX: 80, screenY: 90 })]);
  });

  it("ignores a right-click pointerdown so it can never start a tool gesture", () => {
    const element = new FakeElement();
    const win = new FakeWindow();
    const projector: PointerProjector = { screenToWorld: (x, y) => ({ x, y }) };
    const downs: unknown[] = [];
    const moves: unknown[] = [];
    new PointerInputDispatcher(
      element as unknown as HTMLElement,
      projector,
      noopHandlers({ onDown: (e) => downs.push(e), onMove: (e) => moves.push(e) }),
      win,
    );

    // Browsers suppress the matching pointerup once a right-click opens a context menu,
    // so if onDown fired here there would be no corresponding onUp to end the gesture —
    // the regression this test guards against.
    element.fire("pointerdown", fakePointerEvent({ button: 2, buttons: 2 }));
    expect(downs).toEqual([]);

    // Mouse movement after the (ignored) right-click must not be mistaken for a
    // continuing drag — pointermove fires on hover regardless of button state.
    win.fire("pointermove", fakePointerEvent({ clientX: 50, clientY: 50, buttons: 0 }));
    expect(moves).toHaveLength(1);
  });

  it("allows a normal left-click pointerdown through", () => {
    const element = new FakeElement();
    const projector: PointerProjector = { screenToWorld: (x, y) => ({ x, y }) };
    const downs: unknown[] = [];
    new PointerInputDispatcher(
      element as unknown as HTMLElement,
      projector,
      noopHandlers({ onDown: (e) => downs.push(e) }),
      new FakeWindow(),
    );

    element.fire("pointerdown", fakePointerEvent({ button: 0, buttons: 1 }));

    expect(downs).toHaveLength(1);
  });

  it("delivers a pointerup that lands outside the element, since move/up/cancel listen on window", () => {
    // This is the actual bug this design guards against: dragging off the canvas and
    // releasing the button elsewhere. A real browser routes that pointerup to whatever's
    // under the cursor, not to `element` — so `element`-scoped listeners would never see
    // it and the tool's "pointer is down" state would never clear. Listening on `window`
    // instead means the release is still delivered, since it bubbles there regardless of
    // where it lands (confirmed empirically against `setPointerCapture`, which does not
    // reliably redirect the release event — see the constructor's doc comment).
    const element = new FakeElement();
    const win = new FakeWindow();
    const projector: PointerProjector = { screenToWorld: (x, y) => ({ x, y }) };
    const ups: unknown[] = [];
    new PointerInputDispatcher(
      element as unknown as HTMLElement,
      projector,
      noopHandlers({ onUp: (e) => ups.push(e) }),
      win,
    );

    element.fire("pointerdown", fakePointerEvent({ pointerId: 7, button: 0, buttons: 1 }));
    // The release lands on `win`, never on `element` — simulating the cursor being
    // physically outside the canvas when the button comes up.
    win.fire("pointerup", fakePointerEvent({ pointerId: 7, clientX: -500, clientY: -500 }));

    expect(ups).toHaveLength(1);
  });

  it("stops listening on window once disposed", () => {
    const element = new FakeElement();
    const win = new FakeWindow();
    const projector: PointerProjector = { screenToWorld: (x, y) => ({ x, y }) };
    const ups: unknown[] = [];
    const dispatcher = new PointerInputDispatcher(
      element as unknown as HTMLElement,
      projector,
      noopHandlers({ onUp: (e) => ups.push(e) }),
      win,
    );

    element.fire("pointerdown", fakePointerEvent({ pointerId: 3 }));
    dispatcher.dispose();
    win.fire("pointerup", fakePointerEvent({ pointerId: 3 }));

    // A leaked window listener from a disposed dispatcher (e.g. after PageEditorView
    // remounts on a page switch) would keep feeding a dead scene graph — dispose() must
    // actually detach it, not just the element-scoped pointerdown listener.
    expect(ups).toEqual([]);
  });

  describe("panning", () => {
    it("routes a middle-click drag to onPanStart/onPanMove/onPanEnd, never to onDown/onMove/onUp", () => {
      const element = new FakeElement();
      const win = new FakeWindow();
      const projector: PointerProjector = { screenToWorld: (x, y) => ({ x, y }) };
      const downs: unknown[] = [];
      const moves: unknown[] = [];
      const ups: unknown[] = [];
      const panStarts: unknown[] = [];
      const panMoves: unknown[] = [];
      const panEnds: unknown[] = [];
      new PointerInputDispatcher(
        element as unknown as HTMLElement,
        projector,
        noopHandlers({
          onDown: (e) => downs.push(e),
          onMove: (e) => moves.push(e),
          onUp: (e) => ups.push(e),
          onPanStart: (e) => panStarts.push(e),
          onPanMove: (e) => panMoves.push(e),
          onPanEnd: (e) => panEnds.push(e),
        }),
        win,
      );

      element.fire("pointerdown", fakePointerEvent({ pointerId: 9, button: 1, buttons: 4 }));
      win.fire("pointermove", fakePointerEvent({ pointerId: 9, clientX: 30, clientY: 10 }));
      win.fire("pointerup", fakePointerEvent({ pointerId: 9 }));

      expect(panStarts).toHaveLength(1);
      expect(panMoves).toHaveLength(1);
      expect(panEnds).toHaveLength(1);
      expect(downs).toEqual([]);
      expect(moves).toEqual([]);
      expect(ups).toEqual([]);
    });

    it("routes a Ctrl+primary-click drag to pan instead of starting a tool gesture", () => {
      const element = new FakeElement();
      const projector: PointerProjector = { screenToWorld: (x, y) => ({ x, y }) };
      const downs: unknown[] = [];
      const panStarts: unknown[] = [];
      new PointerInputDispatcher(
        element as unknown as HTMLElement,
        projector,
        noopHandlers({ onDown: (e) => downs.push(e), onPanStart: (e) => panStarts.push(e) }),
        new FakeWindow(),
      );

      element.fire("pointerdown", fakePointerEvent({ button: 0, buttons: 1, ctrlKey: true }));

      expect(panStarts).toHaveLength(1);
      expect(downs).toEqual([]);
    });

    it("a plain (non-Ctrl) primary click still starts a normal tool gesture, not a pan", () => {
      const element = new FakeElement();
      const projector: PointerProjector = { screenToWorld: (x, y) => ({ x, y }) };
      const downs: unknown[] = [];
      const panStarts: unknown[] = [];
      new PointerInputDispatcher(
        element as unknown as HTMLElement,
        projector,
        noopHandlers({ onDown: (e) => downs.push(e), onPanStart: (e) => panStarts.push(e) }),
        new FakeWindow(),
      );

      element.fire("pointerdown", fakePointerEvent({ button: 0, buttons: 1, ctrlKey: false }));

      expect(downs).toHaveLength(1);
      expect(panStarts).toEqual([]);
    });
  });

  describe("wheel panning", () => {
    it("reports a plain wheel tick as vertical pan", () => {
      const element = new FakeElement();
      const projector: PointerProjector = { screenToWorld: (x, y) => ({ x, y }) };
      const wheelPans: Array<{ deltaX: number; deltaY: number }> = [];
      new PointerInputDispatcher(
        element as unknown as HTMLElement,
        projector,
        noopHandlers({ onWheelPan: (deltaX, deltaY) => wheelPans.push({ deltaX, deltaY }) }),
        new FakeWindow(),
      );

      element.fire("wheel", fakeWheelEvent({ deltaX: 0, deltaY: 40 }));

      expect(wheelPans).toEqual([{ deltaX: 0, deltaY: 40 }]);
    });

    it("routes Shift+wheel to horizontal pan even when the native event didn't swap deltaX/deltaY itself", () => {
      const element = new FakeElement();
      const projector: PointerProjector = { screenToWorld: (x, y) => ({ x, y }) };
      const wheelPans: Array<{ deltaX: number; deltaY: number }> = [];
      new PointerInputDispatcher(
        element as unknown as HTMLElement,
        projector,
        noopHandlers({ onWheelPan: (deltaX, deltaY) => wheelPans.push({ deltaX, deltaY }) }),
        new FakeWindow(),
      );

      element.fire("wheel", fakeWheelEvent({ deltaX: 0, deltaY: 40, shiftKey: true }));

      expect(wheelPans).toEqual([{ deltaX: 40, deltaY: 0 }]);
    });

    it("routes Ctrl+wheel to zoom instead of pan, anchored to the element-relative cursor position", () => {
      const element = new FakeElement();
      element.rect = { left: 220, top: 60 };
      const projector: PointerProjector = { screenToWorld: (x, y) => ({ x, y }) };
      const wheelPans: unknown[] = [];
      const wheelZooms: Array<{ deltaY: number; screenX: number; screenY: number }> = [];
      new PointerInputDispatcher(
        element as unknown as HTMLElement,
        projector,
        noopHandlers({
          onWheelPan: (deltaX, deltaY) => wheelPans.push({ deltaX, deltaY }),
          onWheelZoom: (deltaY, screenX, screenY) => wheelZooms.push({ deltaY, screenX, screenY }),
        }),
        new FakeWindow(),
      );

      element.fire("wheel", fakeWheelEvent({ deltaY: -100, clientX: 320, clientY: 160, ctrlKey: true }));

      expect(wheelPans).toEqual([]);
      expect(wheelZooms).toEqual([{ deltaY: -100, screenX: 100, screenY: 100 }]);
    });
  });

  describe("source overrides", () => {
    it("reports the overridden source in the normalized event, not the raw pointerType", () => {
      const element = new FakeElement();
      const projector: PointerProjector = { screenToWorld: (x, y) => ({ x, y }) };
      const downs: Array<{ source: string }> = [];
      new PointerInputDispatcher(
        element as unknown as HTMLElement,
        projector,
        noopHandlers({ onDown: (e) => downs.push(e) }),
        new FakeWindow(),
        { mouse: "pen" },
      );

      element.fire("pointerdown", fakePointerEvent({ pointerType: "mouse" }));

      expect(downs).toEqual([expect.objectContaining({ source: "pen" })]);
    });

    it("reads the overrides object live — a change made after construction applies to the very next event, not just events after reconstruction", () => {
      const element = new FakeElement();
      const projector: PointerProjector = { screenToWorld: (x, y) => ({ x, y }) };
      const downs: Array<{ source: string }> = [];
      const overrides: Record<string, string> = {};
      new PointerInputDispatcher(
        element as unknown as HTMLElement,
        projector,
        noopHandlers({ onDown: (e) => downs.push(e) }),
        new FakeWindow(),
        overrides,
      );

      element.fire("pointerdown", fakePointerEvent({ pointerType: "touch", pointerId: 1 }));
      overrides.touch = "pen";
      element.fire("pointerdown", fakePointerEvent({ pointerType: "touch", pointerId: 2 }));

      expect(downs.map((e) => e.source)).toEqual(["touch", "pen"]);
    });

    it("an override applies to palm-rejection classification too, not just the reported source field", () => {
      // With touch->pen overridden, a "touch" pointerdown should be treated as the pen
      // itself (setting activePenPointerId) rather than being palm-rejection-suppressed —
      // confirms the override is read consistently everywhere the dispatcher branches on
      // device type, not only in normalize().
      const element = new FakeElement();
      const projector: PointerProjector = { screenToWorld: (x, y) => ({ x, y }) };
      const downs: unknown[] = [];
      new PointerInputDispatcher(
        element as unknown as HTMLElement,
        projector,
        noopHandlers({ onDown: (e) => downs.push(e) }),
        new FakeWindow(),
        { touch: "pen" },
      );

      element.fire("pointerdown", fakePointerEvent({ pointerType: "touch", pointerId: 1 }));
      // A second concurrent "touch" contact would normally be suppressed while a pen is
      // active — but since the first contact was itself reclassified as "pen" by the
      // override, there's no real touch source active, so this one is NOT rejected either
      // (it's independently reclassified to "pen" too).
      element.fire("pointerdown", fakePointerEvent({ pointerType: "touch", pointerId: 2 }));

      expect(downs).toHaveLength(2);
    });
  });
});
