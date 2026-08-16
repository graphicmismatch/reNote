import { describe, expect, it } from "vitest";
import type { Bounds } from "@renote/core";
import {
  chunkKeyFor,
  chunkOriginFor,
  GridSpatialIndex,
  LinearSpatialIndex,
  type SpatialIndex,
} from "./spatial-index.js";

const CELL_SIZE = 1024;

/**
 * Both implementations of `SpatialIndex` must behave identically — this suite runs against
 * each in turn rather than special-casing either one.
 */
const implementations: Array<{ name: string; create: () => SpatialIndex }> = [
  { name: "LinearSpatialIndex", create: () => new LinearSpatialIndex() },
  { name: "GridSpatialIndex", create: () => new GridSpatialIndex(CELL_SIZE) },
];

for (const { name, create } of implementations) {
  describe(name, () => {
    it("finds an inserted object via queryRect", () => {
      const index = create();
      index.insert("a", { x: 10, y: 10, width: 20, height: 20 });
      expect(index.queryRect({ x: 0, y: 0, width: 100, height: 100 })).toContain("a");
    });

    it("finds an inserted object via queryPoint", () => {
      const index = create();
      index.insert("a", { x: 10, y: 10, width: 20, height: 20 });
      expect(index.queryPoint(15, 15)).toContain("a");
    });

    it("update moves an object: old position no longer matches, new position does", () => {
      const index = create();
      index.insert("a", { x: 0, y: 0, width: 10, height: 10 });
      expect(index.queryPoint(5, 5)).toContain("a");

      index.update("a", { x: 5000, y: 5000, width: 10, height: 10 });
      expect(index.queryPoint(5, 5)).not.toContain("a");
      expect(index.queryPoint(5005, 5005)).toContain("a");
    });

    it("remove makes the object disappear from both query methods", () => {
      const index = create();
      index.insert("a", { x: 0, y: 0, width: 10, height: 10 });
      index.remove("a");
      expect(index.queryPoint(5, 5)).toEqual([]);
      expect(index.queryRect({ x: 0, y: 0, width: 10, height: 10 })).toEqual([]);
    });

    it("finds an object whose bounds span multiple grid cells, via a query overlapping only one of them", () => {
      const index = create();
      // Spans cells (0,0) through (2,0) at CELL_SIZE=1024.
      const wideBounds: Bounds = { x: 100, y: 100, width: CELL_SIZE * 2, height: 10 };
      index.insert("wide", wideBounds);

      // Query rect entirely within the last cell the object spans, far from its origin cell.
      const farRect: Bounds = { x: CELL_SIZE * 2 + 10, y: 100, width: 10, height: 10 };
      expect(index.queryRect(farRect)).toContain("wide");
      expect(index.queryPoint(CELL_SIZE * 2 + 15, 105)).toContain("wide");
    });

    it("querying an empty index returns []", () => {
      const index = create();
      expect(index.queryRect({ x: 0, y: 0, width: 100, height: 100 })).toEqual([]);
      expect(index.queryPoint(0, 0)).toEqual([]);
    });

    it("returns multiple objects that all fall within the same query region", () => {
      const index = create();
      index.insert("a", { x: 0, y: 0, width: 10, height: 10 });
      index.insert("b", { x: 5, y: 5, width: 10, height: 10 });
      index.insert("c", { x: 20, y: 20, width: 10, height: 10 });

      const hits = index.queryRect({ x: 0, y: 0, width: 100, height: 100 });
      expect(new Set(hits)).toEqual(new Set(["a", "b", "c"]));
    });
  });
}

describe("chunkKeyFor / chunkOriginFor", () => {
  it("round-trips to the floor-aligned cell origin", () => {
    const cases: Array<{ x: number; y: number; cellSize: number }> = [
      { x: 0, y: 0, cellSize: 1024 },
      { x: 1023, y: 1023, cellSize: 1024 },
      { x: 1024, y: 1024, cellSize: 1024 },
      { x: -1, y: -1, cellSize: 1024 },
      { x: -1025, y: 2049, cellSize: 1024 },
      { x: 15_000_000.5, y: -15_000_000.5, cellSize: 512 },
      { x: 100, y: 100, cellSize: 1 },
    ];

    for (const { x, y, cellSize } of cases) {
      const key = chunkKeyFor(x, y, cellSize);
      const origin = chunkOriginFor(key, cellSize);
      expect(origin.x).toBe(Math.floor(x / cellSize) * cellSize);
      expect(origin.y).toBe(Math.floor(y / cellSize) * cellSize);
      // The origin must itself be inside (or exactly at the start of) the cell that produced it.
      expect(origin.x).toBeLessThanOrEqual(x);
      expect(origin.y).toBeLessThanOrEqual(y);
      expect(x - origin.x).toBeLessThan(cellSize);
      expect(y - origin.y).toBeLessThan(cellSize);
    }
  });

  it("produces the same key for two points in the same cell", () => {
    const cellSize = 1024;
    expect(chunkKeyFor(10, 10, cellSize)).toBe(chunkKeyFor(500, 900, cellSize));
    expect(chunkKeyFor(1500, 1500, cellSize)).toBe(chunkKeyFor(1600, 1999, cellSize));
  });

  it("produces different keys for points in adjacent cells", () => {
    const cellSize = 1024;
    expect(chunkKeyFor(1023, 0, cellSize)).not.toBe(chunkKeyFor(1024, 0, cellSize));
    expect(chunkKeyFor(0, 1023, cellSize)).not.toBe(chunkKeyFor(0, 1024, cellSize));
  });
});

/** Small deterministic PRNG (mulberry32) so the randomized property test below is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("GridSpatialIndex vs LinearSpatialIndex (randomized property test)", () => {
  it("produce identical query results for the same random objects and queries", () => {
    const rand = mulberry32(1234567);
    const COORDINATE_RANGE = 20_000; // scattered across a large coordinate range, both +/-
    const OBJECT_COUNT = 300;
    const QUERY_COUNT = 200;

    const linear = new LinearSpatialIndex();
    const grid = new GridSpatialIndex(CELL_SIZE);

    for (let i = 0; i < OBJECT_COUNT; i += 1) {
      const id = `obj-${i}`;
      const x = (rand() - 0.5) * 2 * COORDINATE_RANGE;
      const y = (rand() - 0.5) * 2 * COORDINATE_RANGE;
      // Mix of tiny objects and objects spanning multiple grid cells.
      const width = rand() < 0.15 ? rand() * CELL_SIZE * 4 : rand() * 20;
      const height = rand() < 0.15 ? rand() * CELL_SIZE * 4 : rand() * 20;
      const bounds: Bounds = { x, y, width, height };
      linear.insert(id, bounds);
      grid.insert(id, bounds);
    }

    // Move a subset of objects around to exercise update().
    for (let i = 0; i < OBJECT_COUNT; i += 1) {
      if (rand() < 0.3) {
        const id = `obj-${i}`;
        const bounds: Bounds = {
          x: (rand() - 0.5) * 2 * COORDINATE_RANGE,
          y: (rand() - 0.5) * 2 * COORDINATE_RANGE,
          width: rand() * 50,
          height: rand() * 50,
        };
        linear.update(id, bounds);
        grid.update(id, bounds);
      }
    }

    // Remove a subset to exercise remove().
    for (let i = 0; i < OBJECT_COUNT; i += 1) {
      if (rand() < 0.1) {
        const id = `obj-${i}`;
        linear.remove(id);
        grid.remove(id);
      }
    }

    for (let q = 0; q < QUERY_COUNT; q += 1) {
      if (rand() < 0.5) {
        const rect: Bounds = {
          x: (rand() - 0.5) * 2 * COORDINATE_RANGE,
          y: (rand() - 0.5) * 2 * COORDINATE_RANGE,
          width: rand() * CELL_SIZE * 3,
          height: rand() * CELL_SIZE * 3,
        };
        const linearHits = [...linear.queryRect(rect)].sort();
        const gridHits = [...grid.queryRect(rect)].sort();
        expect(gridHits).toEqual(linearHits);
      } else {
        const x = (rand() - 0.5) * 2 * COORDINATE_RANGE;
        const y = (rand() - 0.5) * 2 * COORDINATE_RANGE;
        const linearHits = [...linear.queryPoint(x, y)].sort();
        const gridHits = [...grid.queryPoint(x, y)].sort();
        expect(gridHits).toEqual(linearHits);
      }
    }
  });
});
