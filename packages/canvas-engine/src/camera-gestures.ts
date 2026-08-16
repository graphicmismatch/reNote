export interface PanAnchor {
  screenX: number;
  screenY: number;
  cameraX: number;
  cameraY: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Given a pan gesture's fixed starting anchor (screen position + camera position at
 * gesture start) and the pointer's current screen position, returns the camera position
 * that keeps the originally-grabbed point under the cursor. Re-derived from the anchor
 * on every call rather than accumulated incrementally from the previous move, so drift
 * can't build up over a long drag and a missed intermediate move can't throw it off.
 */
export function computePannedCamera(
  anchor: PanAnchor,
  screenX: number,
  screenY: number,
  zoom: number,
): Camera {
  return {
    x: anchor.cameraX - (screenX - anchor.screenX) / zoom,
    y: anchor.cameraY - (screenY - anchor.screenY) / zoom,
    zoom,
  };
}

/** Applies a scroll-wheel pan tick (screen pixels) to the current camera. */
export function applyWheelPan(camera: Camera, deltaX: number, deltaY: number): Camera {
  return {
    x: camera.x + deltaX / camera.zoom,
    y: camera.y + deltaY / camera.zoom,
    zoom: camera.zoom,
  };
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
/** Tuned so one physical mouse-wheel notch (~deltaY 100) is roughly a 14% zoom step —
 *  Math.exp(-100 * 0.0015) ≈ 0.86 — while a trackpad's many small synthetic wheel ticks
 *  (Chrome reports Ctrl+wheel for a trackpad pinch) compose into smooth continuous zoom. */
const ZOOM_SPEED = 0.0015;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Computes the camera after a Ctrl+wheel (or trackpad pinch, which Chrome reports as
 * Ctrl+wheel) zoom tick, anchored to the cursor position so the world point currently
 * under the cursor stays under it — the standard "zoom toward cursor" behavior every
 * pan/zoom canvas app uses, rather than always zooming toward the viewport center.
 */
export function computeZoomedCamera(
  camera: Camera,
  deltaY: number,
  screenX: number,
  screenY: number,
): Camera {
  const zoom = clamp(camera.zoom * Math.exp(-deltaY * ZOOM_SPEED), MIN_ZOOM, MAX_ZOOM);
  const worldX = camera.x + screenX / camera.zoom;
  const worldY = camera.y + screenY / camera.zoom;
  return {
    x: worldX - screenX / zoom,
    y: worldY - screenY / zoom,
    zoom,
  };
}
