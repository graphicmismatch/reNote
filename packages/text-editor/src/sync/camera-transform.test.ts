import { describe, expect, it } from "vitest";
import { cameraToCssTransform } from "./camera-transform.js";

describe("cameraToCssTransform", () => {
  it("projects a world-space object position into screen-space CSS transform", () => {
    const transform = cameraToCssTransform({ x: 100, y: 50, zoom: 2 }, 150, 100);
    expect(transform).toBe("translate(100px, 100px) scale(2)");
  });

  it("keeps the object at the origin when the camera is at the origin with zoom 1", () => {
    const transform = cameraToCssTransform({ x: 0, y: 0, zoom: 1 }, 0, 0);
    expect(transform).toBe("translate(0px, 0px) scale(1)");
  });
});
