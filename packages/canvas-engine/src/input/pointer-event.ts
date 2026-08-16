export type PointerSource = "mouse" | "pen" | "touch";

/**
 * Manual "treat X input as Y" remapping (Xournal++-style device-treatment override), for
 * hardware the OS/browser misreports — the one case this actually helps is a tablet/stylus
 * whose `pointerType` genuinely comes through as `"touch"` (or, on some Linux setups without
 * a vendor driver, `"mouse"`) instead of `"pen"`. It does NOT recover pressure/tilt data that
 * never reached the browser in the first place (a real Linux-driver problem, not something a
 * WebView can work around) — only the coarse source classification. There is no cross-platform
 * way to enumerate/identify a *specific* connected device from inside a WebView (`navigator.hid`
 * /WebHID is Chromium-only, unavailable in WebKitGTK/WKWebView), so this remaps by reported
 * type rather than by a literal named-device list.
 */
export type PointerSourceOverrides = Partial<Record<PointerSource, PointerSource>>;

/** Pointer input normalized across mouse, stylus/pen tablets, and touchscreens. */
export interface NormalizedPointerEvent {
  readonly pointerId: number;
  readonly source: PointerSource;
  /** Page-space (world) coordinates, already un-projected from screen space by the camera. */
  readonly x: number;
  readonly y: number;
  /**
   * Raw element-relative pixel coordinates, before camera projection. Optional (absent on
   * hand-built test fixtures that predate this field) — panning is the one consumer that
   * needs them: computing a pan delta from `x`/`y` would use a reference frame (the
   * camera) that's itself being mutated mid-gesture, while these stay stable throughout.
   */
  readonly screenX?: number;
  readonly screenY?: number;
  /** 0..1. Always 1 for mouse and for pen/touch hardware that doesn't report pressure. */
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly isEraser: boolean;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

export function normalizedSourceOf(
  pointerType: string,
  overrides: PointerSourceOverrides = {},
): PointerSource {
  const reported: PointerSource = pointerType === "pen" ? "pen" : pointerType === "touch" ? "touch" : "mouse";
  return overrides[reported] ?? reported;
}
