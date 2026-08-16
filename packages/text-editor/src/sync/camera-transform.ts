/**
 * Computes the CSS transform that keeps a DOM text-field overlay tracking the
 * canvas camera. Applied once per camera update via a single `transform`
 * write rather than per-character layout — see the project plan's text
 * strategy for why text boxes are DOM overlays instead of Pixi-rendered glyphs.
 */
export function cameraToCssTransform(
  camera: { x: number; y: number; zoom: number },
  objectX: number,
  objectY: number,
): string {
  const screenX = (objectX - camera.x) * camera.zoom;
  const screenY = (objectY - camera.y) * camera.zoom;
  return `translate(${screenX}px, ${screenY}px) scale(${camera.zoom})`;
}
