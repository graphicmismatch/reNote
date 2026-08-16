import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Panel } from "./Panel.js";
import "./Minimap.css";

export interface MinimapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MinimapProps {
  /** World-space bounding box of all page content, or null for an empty page (nothing drawn yet). */
  contentBounds: MinimapRect | null;
  /** World-space rect currently visible in the main canvas viewport. Always provided, even over an empty page. */
  viewportRect: MinimapRect;
  /** Called with a world-space point when the user clicks or drags inside the minimap — the
   *  consumer is expected to recenter the camera on this point. Fires continuously during a
   *  drag (not just on release) so navigation feels like a live "radar" control, not a
   *  click-then-jump. */
  onNavigate: (worldX: number, worldY: number) => void;
}

// Fixed pixel footprint of the minimap's drawing surface (CSS px).
const MINIMAP_WIDTH_PX = 200;
const MINIMAP_HEIGHT_PX = 140;

// Fraction of the world extent's own width/height added as breathing room on
// every side, so the content/viewport rectangles never touch the minimap's
// own border.
const EXTENT_PADDING_RATIO = 0.1;

// World-space extents narrower/shorter than this (a single point, or a
// zero-sized viewport before the canvas has measured itself) are clamped up
// to this size before any division, so scale computation never divides by
// zero or produces NaN/Infinity.
const MIN_EXTENT_SIZE = 1;

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function rectToBounds(rect: MinimapRect): Bounds {
  return {
    minX: rect.x,
    minY: rect.y,
    maxX: rect.x + rect.width,
    maxY: rect.y + rect.height,
  };
}

function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Uniform world<->screen mapping computed fresh for one Minimap render. */
interface Transform {
  scale: number;
  // World-space top-left corner of the padded, clamped extent.
  worldMinX: number;
  worldMinY: number;
  // Screen-space offset of that corner within the fixed box (nonzero when
  // the extent's aspect ratio doesn't match the box's, i.e. letterboxing).
  offsetX: number;
  offsetY: number;
}

/**
 * Union of contentBounds (if present) and viewportRect, padded and fit to a
 * uniform scale inside the fixed minimap box. The viewport is always part of
 * the union so it's always visible on the minimap, even panned far from any
 * actual content.
 */
function computeTransform(contentBounds: MinimapRect | null, viewportRect: MinimapRect): Transform {
  let bounds = rectToBounds(viewportRect);
  if (contentBounds) {
    bounds = unionBounds(bounds, rectToBounds(contentBounds));
  }

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const extentWidth = Math.max(bounds.maxX - bounds.minX, MIN_EXTENT_SIZE);
  const extentHeight = Math.max(bounds.maxY - bounds.minY, MIN_EXTENT_SIZE);

  const paddedWidth = extentWidth * (1 + 2 * EXTENT_PADDING_RATIO);
  const paddedHeight = extentHeight * (1 + 2 * EXTENT_PADDING_RATIO);

  const scale = Math.min(MINIMAP_WIDTH_PX / paddedWidth, MINIMAP_HEIGHT_PX / paddedHeight);
  const renderedWidth = paddedWidth * scale;
  const renderedHeight = paddedHeight * scale;

  return {
    scale,
    worldMinX: centerX - paddedWidth / 2,
    worldMinY: centerY - paddedHeight / 2,
    offsetX: (MINIMAP_WIDTH_PX - renderedWidth) / 2,
    offsetY: (MINIMAP_HEIGHT_PX - renderedHeight) / 2,
  };
}

interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function worldRectToScreen(rect: MinimapRect, transform: Transform): ScreenRect {
  return {
    left: transform.offsetX + (rect.x - transform.worldMinX) * transform.scale,
    top: transform.offsetY + (rect.y - transform.worldMinY) * transform.scale,
    width: rect.width * transform.scale,
    height: rect.height * transform.scale,
  };
}

function screenToWorld(
  screenX: number,
  screenY: number,
  transform: Transform,
): { worldX: number; worldY: number } {
  return {
    worldX: transform.worldMinX + (screenX - transform.offsetX) / transform.scale,
    worldY: transform.worldMinY + (screenY - transform.offsetY) / transform.scale,
  };
}

/**
 * Radar-style overview of the page: shows where the current viewport sits
 * relative to the page's content, and lets the user click/drag inside the
 * box to recenter the camera. Purely presentational — takes plain numbers,
 * knows nothing about a camera, scene graph, or PageEngine; a consumer in
 * apps/desktop is responsible for translating real engine state into these
 * props (mirrors how TrashPanel/HistoryPanel define their own local prop
 * shapes instead of importing engine DTOs).
 */
export function Minimap({ contentBounds, viewportRect, onNavigate }: MinimapProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const transform = computeTransform(contentBounds, viewportRect);

  const navigateFromClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const box = boxRef.current;
      if (!box) return;
      const boxRect = box.getBoundingClientRect();
      const { worldX, worldY } = screenToWorld(clientX - boxRect.left, clientY - boxRect.top, transform);
      onNavigate(worldX, worldY);
    },
    [transform, onNavigate],
  );

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    navigateFromClientPoint(event.clientX, event.clientY);
  };

  // Track the drag on window, not just the box, so the navigate callback
  // keeps firing even if the pointer briefly leaves the (small) minimap box
  // mid-drag. Listeners are only attached while isDragging is true, and are
  // always removed on mouseup or unmount — no leaked window listeners.
  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (event: MouseEvent) => navigateFromClientPoint(event.clientX, event.clientY);
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, navigateFromClientPoint]);

  const contentScreenRect = contentBounds ? worldRectToScreen(contentBounds, transform) : null;
  const viewportScreenRect = worldRectToScreen(viewportRect, transform);

  return (
    <Panel title="Minimap">
      <div className="renote-minimap">
        <div
          ref={boxRef}
          className="renote-minimap-box"
          style={{ width: MINIMAP_WIDTH_PX, height: MINIMAP_HEIGHT_PX }}
          onMouseDown={handleMouseDown}
        >
          {contentScreenRect && (
            <div
              className="renote-minimap-content-rect"
              style={{
                left: contentScreenRect.left,
                top: contentScreenRect.top,
                width: contentScreenRect.width,
                height: contentScreenRect.height,
              }}
            />
          )}
          <div
            className="renote-minimap-viewport-rect"
            style={{
              left: viewportScreenRect.left,
              top: viewportScreenRect.top,
              width: viewportScreenRect.width,
              height: viewportScreenRect.height,
            }}
          />
        </div>
      </div>
    </Panel>
  );
}
