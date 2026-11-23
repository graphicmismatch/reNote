/**
 * Mirrors `renote_storage::Transform2D` / `packages/core/src/page-object/transform.ts`'s
 * `Transform2D`.
 */
export type Transform2DDto = {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  zIndex: number;
};
