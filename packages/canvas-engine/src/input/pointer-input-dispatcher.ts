import {
  type NormalizedPointerEvent,
  type PointerSourceOverrides,
  normalizedSourceOf,
} from "./pointer-event.js";

export interface PointerProjector {
  screenToWorld(screenX: number, screenY: number): { x: number; y: number };
}

export interface PointerInputHandlers {
  onDown(event: NormalizedPointerEvent): void;
  onMove(event: NormalizedPointerEvent): void;
  onUp(event: NormalizedPointerEvent): void;
  /** A pan gesture (middle-click drag, or Ctrl+primary-click drag) started/continued/ended.
   *  Mutually exclusive with onDown/onMove/onUp for the same pointerId — a pan never also
   *  drives the active tool, so e.g. panning while the pen tool is active never draws. */
  onPanStart(event: NormalizedPointerEvent): void;
  onPanMove(event: NormalizedPointerEvent): void;
  onPanEnd(event: NormalizedPointerEvent): void;
  /** Plain scroll-wheel panning. `deltaX`/`deltaY` are screen pixels, sign matching the
   *  native `WheelEvent` (positive deltaY = content should move up, matching a typical
   *  "scroll down" gesture). Shift+wheel is normalized here too: browsers already swap
   *  deltaX/deltaY for a shift-held wheel on many platforms, but not consistently, so the
   *  dispatcher does it explicitly rather than relying on that. */
  onWheelPan(deltaX: number, deltaY: number): void;
  /** Ctrl+wheel zoom (also how Chrome reports a trackpad pinch gesture). `screenX`/`screenY`
   *  are the element-relative point to zoom toward, so the world point under the cursor
   *  stays fixed on screen rather than always zooming toward the viewport center. */
  onWheelZoom(deltaY: number, screenX: number, screenY: number): void;
}

/** The subset of `Window` this dispatcher needs for the move/up/cancel listeners it
 *  attaches globally (see the constructor's doc comment for why those listen on the
 *  window instead of the canvas element). Narrowed to just this so a test double doesn't
 *  need to impersonate a full `Window`. */
export interface GlobalPointerEventTarget {
  addEventListener(type: string, handler: (event: PointerEvent) => void): void;
  removeEventListener(type: string, handler: (event: PointerEvent) => void): void;
}

/** Eraser end of a stylus reports as buttons=32 per the Pointer Events spec. */
const ERASER_BUTTONS_MASK = 32;

/**
 * `PointerEvent.button` values (per spec) that should be allowed to start a drawing gesture:
 * 0 = primary contact (left mouse button, touch contact, pen tip), 5 = pen eraser tip.
 * Everything else — middle-click (1), right-click/secondary (2), and a pen's barrel button
 * acting as a right-click (also 2) — must NOT start a tool gesture. Browsers suppress the
 * matching `pointerup` after a right-click opens a context menu, so if `onDown` fired for it,
 * the tool's "pointer is down" state would never clear: every later `pointermove` (which fires
 * on hover too, not just while a button is held) would keep extending a phantom stroke until
 * some unrelated future pointerup finally committed it.
 */
const DRAW_STARTING_BUTTONS = new Set([0, 5]);

const MIDDLE_BUTTON = 1;

/**
 * Normalizes mouse, stylus/pen, and touch input into one event shape and applies
 * palm rejection: while a pen contact is active, concurrent touch contacts are
 * suppressed from driving drawing tools, and touch input resumes once the pen lifts.
 *
 * Two-finger pan/pinch-zoom disambiguation is intentionally not implemented here yet —
 * it's a Phase 2 spike per the project plan, not an oversight.
 */
export class PointerInputDispatcher {
  private activePenPointerId: number | null = null;
  private activePanPointerId: number | null = null;
  private readonly suppressedTouchPointerIds = new Set<number>();

  constructor(
    private readonly element: HTMLElement,
    private readonly projector: PointerProjector,
    private readonly handlers: PointerInputHandlers,
    // Defaults to the real `window` for production use; tests pass a double so this
    // package stays headless-testable with no real DOM dependency (see class doc comment
    // on `PointerInputDispatcher` and the `NullRenderer` pattern used elsewhere).
    private readonly globalTarget: GlobalPointerEventTarget = window,
    // A mutable object read fresh in `normalize()` on every event, NOT snapshotted here —
    // the owner (an apps/desktop settings provider) mutates this object's fields in place
    // when the user changes the setting, so the change applies to the very next pointer
    // event without needing to reconstruct this dispatcher. See `PointerSourceOverrides`'s
    // doc comment for what this can and can't fix.
    private readonly sourceOverrides: PointerSourceOverrides = {},
  ) {
    this.element.addEventListener("pointerdown", this.handlePointerDown);
    // `pointermove`/`pointerup`/`pointercancel` listen on `globalTarget` (`window`), not
    // `element`: a drag that leaves the canvas (dragging off its edge, releasing the button
    // over the sidebar) still bubbles up through window regardless of where the cursor
    // physically is, whereas an `element`-scoped listener would simply never see the
    // release. Without this, the tool's "pointer is down" state would never clear, and
    // every later hover-only `pointermove` back over the canvas would keep extending the
    // gesture until some unrelated future pointerup finally committed it.
    // `setPointerCapture` looks like the textbook fix for this, but empirically does not
    // redirect the release event for CDP-synthesized input (verified directly: a bare div
    // calling `setPointerCapture` on down, dragged outside via CDP and released there,
    // never received the up — window-level bubbling did). `pointerdown` stays scoped to
    // `element`, since a gesture should only start when the initial press actually lands
    // inside the canvas.
    this.globalTarget.addEventListener("pointermove", this.handlePointerMove);
    this.globalTarget.addEventListener("pointerup", this.handlePointerUp);
    this.globalTarget.addEventListener("pointercancel", this.handlePointerUp);
    // Wheel doesn't have the drag-outside-bounds problem move/up/cancel have above — a
    // wheel tick always hit-tests to whatever's actually under the cursor right now, so
    // element-scoping (rather than window) is both correct and desired: scrolling over the
    // sidebar shouldn't pan the canvas.
    this.element.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  /** Resolves this event's source through `sourceOverrides` — used everywhere this class
   *  branches on device type (palm rejection here, world-space projection in `normalize()`)
   *  so an override is applied consistently, not just to the coordinates a tool sees. */
  private sourceOf(nativeEvent: PointerEvent): ReturnType<typeof normalizedSourceOf> {
    return normalizedSourceOf(nativeEvent.pointerType, this.sourceOverrides);
  }

  private handlePointerDown = (nativeEvent: PointerEvent): void => {
    if (nativeEvent.button === MIDDLE_BUTTON || (nativeEvent.button === 0 && nativeEvent.ctrlKey)) {
      // Prevents the browser's native middle-click autoscroll cursor / Linux
      // primary-selection paste-on-middle-click from firing alongside our own pan.
      nativeEvent.preventDefault();
      this.activePanPointerId = nativeEvent.pointerId;
      this.dispatch(this.handlers.onPanStart, nativeEvent);
      return;
    }
    if (!DRAW_STARTING_BUTTONS.has(nativeEvent.button)) return;
    const source = this.sourceOf(nativeEvent);
    if (source === "pen") {
      this.activePenPointerId = nativeEvent.pointerId;
    } else if (source === "touch" && this.activePenPointerId !== null) {
      this.suppressedTouchPointerIds.add(nativeEvent.pointerId);
      return;
    }
    this.dispatch(this.handlers.onDown, nativeEvent);
  };

  private handlePointerMove = (nativeEvent: PointerEvent): void => {
    if (nativeEvent.pointerId === this.activePanPointerId) {
      this.dispatch(this.handlers.onPanMove, nativeEvent);
      return;
    }
    if (this.suppressedTouchPointerIds.has(nativeEvent.pointerId)) return;
    this.dispatch(this.handlers.onMove, nativeEvent);
  };

  private handlePointerUp = (nativeEvent: PointerEvent): void => {
    if (nativeEvent.pointerId === this.activePanPointerId) {
      this.activePanPointerId = null;
      this.dispatch(this.handlers.onPanEnd, nativeEvent);
      return;
    }
    if (this.suppressedTouchPointerIds.delete(nativeEvent.pointerId)) return;
    if (this.sourceOf(nativeEvent) === "pen" && nativeEvent.pointerId === this.activePenPointerId) {
      this.activePenPointerId = null;
    }
    this.dispatch(this.handlers.onUp, nativeEvent);
  };

  private handleWheel = (nativeEvent: WheelEvent): void => {
    // Also stops the browser's own native Ctrl+wheel page-zoom from firing alongside ours.
    nativeEvent.preventDefault();
    if (nativeEvent.ctrlKey) {
      const rect = this.element.getBoundingClientRect();
      this.handlers.onWheelZoom(
        nativeEvent.deltaY,
        nativeEvent.clientX - rect.left,
        nativeEvent.clientY - rect.top,
      );
      return;
    }
    // Shift+wheel means "scroll horizontally" — some platforms already swap deltaX/deltaY
    // themselves for a shift-held wheel and some don't, so this is made explicit rather
    // than trusted to arrive pre-swapped.
    const deltaX = nativeEvent.shiftKey ? nativeEvent.deltaY : nativeEvent.deltaX;
    const deltaY = nativeEvent.shiftKey ? 0 : nativeEvent.deltaY;
    this.handlers.onWheelPan(deltaX, deltaY);
  };

  private dispatch(handler: (event: NormalizedPointerEvent) => void, nativeEvent: PointerEvent): void {
    const coalesced =
      typeof nativeEvent.getCoalescedEvents === "function" ? nativeEvent.getCoalescedEvents() : [];
    const events = coalesced.length > 0 ? coalesced : [nativeEvent];
    for (const event of events) {
      handler(this.normalize(event));
    }
  }

  private normalize(event: PointerEvent): NormalizedPointerEvent {
    // `clientX`/`clientY` are viewport-relative, but `screenToWorld` expects
    // coordinates relative to this dispatcher's own element (see PageEngine's
    // camera math) — subtract the element's on-page position so drawing still
    // lines up with the pointer once the canvas isn't flush against the
    // viewport's top-left corner (e.g. once a toolbar/sidebar surrounds it).
    const rect = this.element.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const world = this.projector.screenToWorld(screenX, screenY);
    return {
      pointerId: event.pointerId,
      source: this.sourceOf(event),
      x: world.x,
      y: world.y,
      screenX,
      screenY,
      pressure: event.pressure > 0 ? event.pressure : 1,
      tiltX: event.tiltX ?? 0,
      tiltY: event.tiltY ?? 0,
      isEraser: event.pointerType === "pen" && (event.buttons & ERASER_BUTTONS_MASK) !== 0,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
    };
  }

  dispose(): void {
    this.element.removeEventListener("pointerdown", this.handlePointerDown);
    this.globalTarget.removeEventListener("pointermove", this.handlePointerMove);
    this.globalTarget.removeEventListener("pointerup", this.handlePointerUp);
    this.globalTarget.removeEventListener("pointercancel", this.handlePointerUp);
    this.element.removeEventListener("wheel", this.handleWheel);
  }
}
