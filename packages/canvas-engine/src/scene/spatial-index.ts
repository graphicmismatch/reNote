import type { Bounds } from "@renote/core";

export interface SpatialIndex {
  insert(id: string, bounds: Bounds): void;
  update(id: string, bounds: Bounds): void;
  remove(id: string): void;
  /** IDs whose bounds intersect the given rect; used for both viewport culling and lasso selection. */
  queryRect(rect: Bounds): string[];
  queryPoint(x: number, y: number): string[];
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function containsPoint(bounds: Bounds, x: number, y: number): boolean {
  return x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height;
}

/**
 * World-space point -> the key of the `cellSize`-wide/tall grid cell containing it. Shared by
 * `GridSpatialIndex` (below) and `PixiRenderer` (which nests each chunk's Pixi views under a
 * `Container` positioned at that chunk's world-space origin, for floating-origin rendering) —
 * both mechanisms must agree on exactly the same grid, so this is the one place the key format
 * is defined.
 */
export function chunkKeyFor(x: number, y: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
}

/** Inverse of `chunkKeyFor`: a chunk key -> that cell's world-space top-left corner. */
export function chunkOriginFor(chunkKey: string, cellSize: number): { x: number; y: number } {
  const [cellX, cellY] = chunkKey.split(",").map(Number);
  return { x: (cellX ?? 0) * cellSize, y: (cellY ?? 0) * cellSize };
}

/**
 * Linear-scan implementation of SpatialIndex. Correct at any scale, too slow past a
 * few thousand objects — swapping in a uniform-grid or R-tree implementation (Phase 2/3)
 * requires no changes to callers since they only depend on this interface.
 */
export class LinearSpatialIndex implements SpatialIndex {
  private readonly entries = new Map<string, Bounds>();

  insert(id: string, bounds: Bounds): void {
    this.entries.set(id, bounds);
  }

  update(id: string, bounds: Bounds): void {
    this.entries.set(id, bounds);
  }

  remove(id: string): void {
    this.entries.delete(id);
  }

  queryRect(rect: Bounds): string[] {
    const hits: string[] = [];
    for (const [id, bounds] of this.entries) {
      if (intersects(bounds, rect)) hits.push(id);
    }
    return hits;
  }

  queryPoint(x: number, y: number): string[] {
    const hits: string[] = [];
    for (const [id, bounds] of this.entries) {
      if (containsPoint(bounds, x, y)) hits.push(id);
    }
    return hits;
  }
}

/** The cell-key range (inclusive) covering all four corners of `bounds` at `cellSize`. */
function cellKeysFor(bounds: Bounds, cellSize: number): string[] {
  const minX = Math.min(bounds.x, bounds.x + bounds.width);
  const maxX = Math.max(bounds.x, bounds.x + bounds.width);
  const minY = Math.min(bounds.y, bounds.y + bounds.height);
  const maxY = Math.max(bounds.y, bounds.y + bounds.height);
  const minCellX = Math.floor(minX / cellSize);
  const maxCellX = Math.floor(maxX / cellSize);
  const minCellY = Math.floor(minY / cellSize);
  const maxCellY = Math.floor(maxY / cellSize);

  const keys: string[] = [];
  for (let cx = minCellX; cx <= maxCellX; cx += 1) {
    for (let cy = minCellY; cy <= maxCellY; cy += 1) {
      keys.push(`${cx},${cy}`);
    }
  }
  return keys;
}

interface GridEntry {
  bounds: Bounds;
  cellKeys: string[];
}

/**
 * Uniform-grid implementation of SpatialIndex (Phase 5.6): buckets object ids into fixed-size
 * `cellSize`-square cells, so a query only scans candidates from the handful of cells it
 * overlaps instead of every object in the scene. This is a *broad phase* only — every query
 * still finishes by running the exact `intersects`/`containsPoint` tests (same functions
 * `LinearSpatialIndex` uses) against the narrowed candidate set, so correctness is identical to
 * `LinearSpatialIndex`, just faster once object counts grow past a few thousand. An object whose
 * bounds span multiple cells is inserted into every cell it overlaps (see `cellKeysFor`), so a
 * query that only touches one of those cells still finds it.
 */
export class GridSpatialIndex implements SpatialIndex {
  private readonly cells = new Map<string, Set<string>>();
  private readonly entries = new Map<string, GridEntry>();

  constructor(private readonly cellSize = 1024) {}

  insert(id: string, bounds: Bounds): void {
    const cellKeys = cellKeysFor(bounds, this.cellSize);
    for (const key of cellKeys) {
      this.addToCell(key, id);
    }
    this.entries.set(id, { bounds, cellKeys });
  }

  update(id: string, bounds: Bounds): void {
    const existing = this.entries.get(id);
    if (!existing) {
      this.insert(id, bounds);
      return;
    }

    const newCellKeys = cellKeysFor(bounds, this.cellSize);
    const newKeySet = new Set(newCellKeys);
    const oldKeySet = new Set(existing.cellKeys);

    for (const oldKey of existing.cellKeys) {
      if (!newKeySet.has(oldKey)) this.removeFromCell(oldKey, id);
    }
    for (const newKey of newCellKeys) {
      if (!oldKeySet.has(newKey)) this.addToCell(newKey, id);
    }

    this.entries.set(id, { bounds, cellKeys: newCellKeys });
  }

  remove(id: string): void {
    const existing = this.entries.get(id);
    if (!existing) return;
    for (const key of existing.cellKeys) {
      this.removeFromCell(key, id);
    }
    this.entries.delete(id);
  }

  queryRect(rect: Bounds): string[] {
    const candidateIds = new Set<string>();
    for (const key of cellKeysFor(rect, this.cellSize)) {
      const cell = this.cells.get(key);
      if (!cell) continue;
      for (const id of cell) candidateIds.add(id);
    }

    const hits: string[] = [];
    for (const id of candidateIds) {
      const entry = this.entries.get(id);
      if (entry && intersects(entry.bounds, rect)) hits.push(id);
    }
    return hits;
  }

  queryPoint(x: number, y: number): string[] {
    // A single cell suffices: `cellKeysFor` computes each object's cell range with the exact
    // same floor(.../cellSize) formula used here, and floor is monotonic — so the cell
    // containing (x, y) is guaranteed to be within the cell range of any object whose bounds
    // contain (x, y).
    const key = chunkKeyFor(x, y, this.cellSize);
    const cell = this.cells.get(key);
    if (!cell) return [];

    const hits: string[] = [];
    for (const id of cell) {
      const entry = this.entries.get(id);
      if (entry && containsPoint(entry.bounds, x, y)) hits.push(id);
    }
    return hits;
  }

  private addToCell(key: string, id: string): void {
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Set();
      this.cells.set(key, cell);
    }
    cell.add(id);
  }

  private removeFromCell(key: string, id: string): void {
    const cell = this.cells.get(key);
    if (!cell) return;
    cell.delete(id);
    if (cell.size === 0) this.cells.delete(key);
  }
}
