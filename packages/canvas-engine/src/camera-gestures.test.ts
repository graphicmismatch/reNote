import { describe, expect, it } from "vitest";
import { applyWheelPan, computePannedCamera, computeZoomedCamera } from "./camera-gestures.js";

describe("computePannedCamera", () => {
  it("keeps the camera unchanged when the pointer hasn't moved from the anchor", () => {
    const anchor = { screenX: 100, screenY: 100, cameraX: 50, cameraY: 50 };
    expect(computePannedCamera(anchor, 100, 100, 1)).toEqual({ x: 50, y: 50, zoom: 1 });
  });

  it("moves the camera opposite the drag direction, so the grabbed point stays under the cursor", () => {
    const anchor = { screenX: 100, screenY: 100, cameraX: 0, cameraY: 0 };
    // Dragging the pointer right/down by 20px should slide the *camera* left/up by 20
    // world units at zoom 1 — content appears to follow the drag.
    expect(computePannedCamera(anchor, 120, 130, 1)).toEqual({ x: -20, y: -30, zoom: 1 });
  });

  it("scales the screen-pixel delta down to world units by the current zoom", () => {
    const anchor = { screenX: 0, screenY: 0, cameraX: 0, cameraY: 0 };
    expect(computePannedCamera(anchor, 40, 0, 2)).toEqual({ x: -20, y: 0, zoom: 2 });
  });

  it("re-derives from the anchor rather than drifting across repeated calls", () => {
    const anchor = { screenX: 0, screenY: 0, cameraX: 0, cameraY: 0 };
    const first = computePannedCamera(anchor, 10, 0, 1);
    const second = computePannedCamera(anchor, 10, 0, 1);
    // Calling with the same screen position twice (e.g. a duplicate/coalesced move
    // event) must not move the camera further the second time.
    expect(second).toEqual(first);
  });
});

describe("applyWheelPan", () => {
  it("shifts the camera by the wheel delta scaled by zoom", () => {
    expect(applyWheelPan({ x: 10, y: 10, zoom: 1 }, 5, -5)).toEqual({ x: 15, y: 5, zoom: 1 });
  });

  it("scales the delta down to world units at higher zoom", () => {
    expect(applyWheelPan({ x: 0, y: 0, zoom: 2 }, 40, 0)).toEqual({ x: 20, y: 0, zoom: 2 });
  });
});

function worldPointUnderCursor(
  camera: { x: number; y: number; zoom: number },
  screenX: number,
  screenY: number,
) {
  return { x: camera.x + screenX / camera.zoom, y: camera.y + screenY / camera.zoom };
}

describe("computeZoomedCamera", () => {
  it("negative deltaY (scroll up / pinch out) zooms in", () => {
    const result = computeZoomedCamera({ x: 0, y: 0, zoom: 1 }, -100, 400, 300);
    expect(result.zoom).toBeGreaterThan(1);
  });

  it("positive deltaY (scroll down / pinch in) zooms out", () => {
    const result = computeZoomedCamera({ x: 0, y: 0, zoom: 1 }, 100, 400, 300);
    expect(result.zoom).toBeLessThan(1);
  });

  it("keeps the world point under the cursor fixed on screen — the standard zoom-toward-cursor behavior", () => {
    const camera = { x: 100, y: 50, zoom: 1 };
    const before = worldPointUnderCursor(camera, 200, 150);

    const zoomedIn = computeZoomedCamera(camera, -150, 200, 150);
    const afterZoomIn = worldPointUnderCursor(zoomedIn, 200, 150);
    expect(afterZoomIn.x).toBeCloseTo(before.x);
    expect(afterZoomIn.y).toBeCloseTo(before.y);

    const zoomedOut = computeZoomedCamera(camera, 150, 200, 150);
    const afterZoomOut = worldPointUnderCursor(zoomedOut, 200, 150);
    expect(afterZoomOut.x).toBeCloseTo(before.x);
    expect(afterZoomOut.y).toBeCloseTo(before.y);
  });

  it("clamps zoom-in at a maximum instead of growing unbounded", () => {
    let camera = { x: 0, y: 0, zoom: 1 };
    for (let i = 0; i < 200; i += 1) {
      camera = computeZoomedCamera(camera, -500, 0, 0);
    }
    expect(camera.zoom).toBeLessThanOrEqual(8);
  });

  it("clamps zoom-out at a minimum instead of shrinking to zero", () => {
    let camera = { x: 0, y: 0, zoom: 1 };
    for (let i = 0; i < 200; i += 1) {
      camera = computeZoomedCamera(camera, 500, 0, 0);
    }
    expect(camera.zoom).toBeGreaterThanOrEqual(0.1);
    expect(camera.zoom).toBeGreaterThan(0);
  });
});
