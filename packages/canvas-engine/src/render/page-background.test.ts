import { describe, expect, it } from "vitest";
import { computeRuleLines, DEFAULT_PAPER_COLOR, resolvePaperColor } from "./page-background.js";

describe("resolvePaperColor", () => {
  it("falls back to the default paper color when the page doesn't specify one", () => {
    expect(resolvePaperColor(null)).toBe(DEFAULT_PAPER_COLOR);
  });

  it("uses the page's own color when set", () => {
    expect(resolvePaperColor("#fceee0")).toBe("#fceee0");
  });
});

describe("computeRuleLines", () => {
  const identityCamera = { x: 0, y: 0, zoom: 1 };

  it('draws nothing for "none"', () => {
    expect(computeRuleLines("none", identityCamera, 200, 200)).toEqual([]);
  });

  it("draws only horizontal lines for college-ruled, spanning the full viewport width", () => {
    const segments = computeRuleLines("college-ruled", identityCamera, 100, 100);
    expect(segments.every((s) => s.kind === "line")).toBe(true);
    // spacing is 24: world y = 0, 24, 48, 72, 96 all fall within [0, 100]
    expect(segments).toHaveLength(5);
    for (const segment of segments) {
      if (segment.kind !== "line") continue;
      expect(segment.x1).toBe(0);
      expect(segment.x2).toBe(100);
      expect(segment.y1).toBe(segment.y2);
    }
  });

  it("draws both horizontal and vertical lines for graph paper", () => {
    const segments = computeRuleLines("graph", identityCamera, 100, 100);
    const horizontal = segments.filter((s) => s.kind === "line" && s.y1 === s.y2);
    const vertical = segments.filter((s) => s.kind === "line" && s.x1 === s.x2);
    expect(horizontal.length).toBeGreaterThan(0);
    expect(vertical.length).toBeGreaterThan(0);
  });

  it("draws a dot grid for dotted paper", () => {
    const segments = computeRuleLines("dotted", identityCamera, 100, 100);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((s) => s.kind === "dot")).toBe(true);
  });

  it("shifts line positions in screen space as the camera pans, proving lines are anchored to world space", () => {
    const atOrigin = computeRuleLines("college-ruled", { x: 0, y: 0, zoom: 1 }, 100, 100);
    const panned = computeRuleLines("college-ruled", { x: 0, y: 10, zoom: 1 }, 100, 100);
    const firstAtOrigin = atOrigin[0];
    const firstPanned = panned[0];
    if (firstAtOrigin?.kind !== "line" || firstPanned?.kind !== "line")
      throw new Error("expected line segments");
    // Panning down by 10 world units shifts every horizontal line's screen Y up by 10 —
    // if lines were viewport-anchored instead of world-anchored, this would stay 0.
    expect(firstPanned.y1).toBe(firstAtOrigin.y1 - 10);
  });

  it("scales line spacing in screen space with zoom", () => {
    const atZoom1 = computeRuleLines("college-ruled", { x: 0, y: 0, zoom: 1 }, 200, 200);
    const atZoom2 = computeRuleLines("college-ruled", { x: 0, y: 0, zoom: 2 }, 200, 200);
    const secondLineAtZoom1 = atZoom1[1];
    const secondLineAtZoom2 = atZoom2[1];
    if (secondLineAtZoom1?.kind !== "line" || secondLineAtZoom2?.kind !== "line") {
      throw new Error("expected line segments");
    }
    // Same world-space spacing (24 units) covers twice the screen distance at 2x zoom.
    expect(secondLineAtZoom2.y1).toBeCloseTo(secondLineAtZoom1.y1 * 2);
  });

  it("returns nothing for a degenerate viewport", () => {
    expect(computeRuleLines("graph", identityCamera, 0, 100)).toEqual([]);
    expect(computeRuleLines("graph", identityCamera, 100, 0)).toEqual([]);
  });
});
