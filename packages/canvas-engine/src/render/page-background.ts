import type { PageRuleLines } from "@renote/core";

/**
 * Fallback paper color when a page doesn't specify one — a fixed, theme-independent
 * value so ink stays readable regardless of chrome light/dark mode. Page background is
 * a document property (`Page.background.color`), not a chrome concern, matching how
 * `pen-tool.ts` keeps its own `DEFAULT_COLOR` at the same layer rather than reaching
 * into `packages/ui`'s tokens.
 */
export const DEFAULT_PAPER_COLOR = "#ffffff";

export function resolvePaperColor(color: string | null): string {
  return color ?? DEFAULT_PAPER_COLOR;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export type RuleLineSegment =
  { kind: "line"; x1: number; y1: number; x2: number; y2: number } | { kind: "dot"; x: number; y: number };

/** World-space spacing (page units) for each rule-line style — roughly evokes real
 *  ruled/graph/dotted paper at the default zoom level. */
const LINE_SPACING: Record<Exclude<PageRuleLines, "none">, number> = {
  "college-ruled": 24,
  "wide-ruled": 32,
  graph: 20,
  dotted: 20,
};

/** Defends against a pathological number of segments at extreme zoom-out — no pan/zoom
 *  UI exists yet, but this keeps the function safe to call with any camera regardless. */
const MAX_SEGMENTS = 5000;

/**
 * Computes screen-space rule-line segments visible for the current viewport and camera.
 * Pure and Pixi-free so it's testable under vitest without a GPU — the renderer just
 * iterates the result and draws it. Lines are computed in world space (snapped to
 * world-space multiples of the style's spacing) and converted to screen space last, so
 * they pan and zoom with page content instead of staying fixed to the viewport.
 */
export function computeRuleLines(
  ruleLines: PageRuleLines,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
): RuleLineSegment[] {
  if (ruleLines === "none" || viewportWidth <= 0 || viewportHeight <= 0 || camera.zoom <= 0) return [];

  const spacing = LINE_SPACING[ruleLines];
  const worldLeft = camera.x;
  const worldTop = camera.y;
  const worldRight = camera.x + viewportWidth / camera.zoom;
  const worldBottom = camera.y + viewportHeight / camera.zoom;

  const toScreenX = (worldX: number) => (worldX - camera.x) * camera.zoom;
  const toScreenY = (worldY: number) => (worldY - camera.y) * camera.zoom;

  const segments: RuleLineSegment[] = [];
  const wantsHorizontal =
    ruleLines === "college-ruled" || ruleLines === "wide-ruled" || ruleLines === "graph";

  if (wantsHorizontal) {
    const firstWorldY = Math.floor(worldTop / spacing) * spacing;
    for (
      let worldY = firstWorldY;
      worldY <= worldBottom && segments.length < MAX_SEGMENTS;
      worldY += spacing
    ) {
      const screenY = toScreenY(worldY);
      segments.push({ kind: "line", x1: 0, y1: screenY, x2: viewportWidth, y2: screenY });
    }
  }

  if (ruleLines === "graph") {
    const firstWorldX = Math.floor(worldLeft / spacing) * spacing;
    for (
      let worldX = firstWorldX;
      worldX <= worldRight && segments.length < MAX_SEGMENTS;
      worldX += spacing
    ) {
      const screenX = toScreenX(worldX);
      segments.push({ kind: "line", x1: screenX, y1: 0, x2: screenX, y2: viewportHeight });
    }
  }

  if (ruleLines === "dotted") {
    const firstWorldX = Math.floor(worldLeft / spacing) * spacing;
    const firstWorldY = Math.floor(worldTop / spacing) * spacing;
    outer: for (let worldY = firstWorldY; worldY <= worldBottom; worldY += spacing) {
      for (let worldX = firstWorldX; worldX <= worldRight; worldX += spacing) {
        if (segments.length >= MAX_SEGMENTS) break outer;
        segments.push({ kind: "dot", x: toScreenX(worldX), y: toScreenY(worldY) });
      }
    }
  }

  return segments;
}
