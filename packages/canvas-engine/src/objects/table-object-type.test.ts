import { describe, expect, it } from "vitest";
import type { Container, Graphics } from "pixi.js";
import { identityTransform, newId, type PageObjectId } from "@renote/core";
import {
  isMergedInteriorSegment,
  mergeCells,
  resizeColumn,
  resizeRow,
  splitMergedCell,
  tableObjectType,
  type TableObject,
} from "./table-object-type.js";
import type { TableData } from "@renote/core";

function makeTableData(overrides: Partial<TableData> = {}): TableData {
  return {
    columnWidths: [50, 50],
    rowHeights: [20, 20],
    cells: [
      ["a", "b"],
      ["c", "d"],
    ],
    mergedRanges: [],
    ...overrides,
  };
}

function makeTable(overrides: Partial<TableData> = {}): TableObject {
  return {
    id: newId<PageObjectId>(),
    type: "table",
    transform: identityTransform(),
    bounds: { x: 0, y: 0, width: 100, height: 40 },
    data: makeTableData(overrides),
  };
}

describe("tableObjectType", () => {
  it("hits a point inside the bounds rect and misses one outside it", () => {
    const table = makeTable();
    expect(tableObjectType.hitTest(table, { x: 50, y: 20 })).toBe(true);
    expect(tableObjectType.hitTest(table, { x: 500, y: 500 })).toBe(false);
  });

  it("validates well-formed data and rejects malformed data", () => {
    const good = makeTableData();
    expect(tableObjectType.validate(good)).toEqual(good);

    expect(() => tableObjectType.validate(null)).toThrow();
    expect(() => tableObjectType.validate({ ...good, columnWidths: "nope" })).toThrow();
    expect(() => tableObjectType.validate({ ...good, cells: "nope" })).toThrow();
    expect(() =>
      tableObjectType.validate({ ...good, mergedRanges: [{ row: "x", col: 0, rowSpan: 1, colSpan: 1 }] }),
    ).toThrow();
  });

  it("createView/updateView run without throwing, including with merged ranges and empty cells", () => {
    const plain = makeTable();
    const view = tableObjectType.createView(plain, { x: 0, y: 0 });
    expect(() => tableObjectType.updateView(view, plain, { x: 0, y: 0 })).not.toThrow();

    const merged = makeTable({ mergedRanges: [{ row: 0, col: 0, rowSpan: 2, colSpan: 2 }] });
    const mergedView = tableObjectType.createView(merged, { x: 0, y: 0 });
    expect(() => tableObjectType.updateView(mergedView, merged, { x: 0, y: 0 })).not.toThrow();

    const withEmptyCells = makeTable({
      cells: [
        [null, "b"],
        ["c", undefined],
      ] as unknown[][],
    });
    const emptyView = tableObjectType.createView(withEmptyCells, { x: 0, y: 0 });
    expect(() => tableObjectType.updateView(emptyView, withEmptyCells, { x: 0, y: 0 })).not.toThrow();
  });

  it("draws chunk-local geometry when given a non-zero origin, not raw world coordinates", () => {
    const table: TableObject = {
      id: newId<PageObjectId>(),
      type: "table",
      transform: identityTransform(),
      bounds: { x: 1_000_000, y: 1_000_000, width: 100, height: 40 },
      data: makeTableData(),
    };
    const origin = { x: 999_000, y: 999_000 };
    const view = tableObjectType.createView(table, origin) as Container & { grid: Graphics };
    const bounds = view.grid.getLocalBounds();

    // Chunk-local: near (1000, 1000), not (1_000_000, 1_000_000).
    expect(bounds.x).toBeGreaterThan(900);
    expect(bounds.x).toBeLessThan(1100);
    expect(bounds.y).toBeGreaterThan(900);
    expect(bounds.y).toBeLessThan(1100);
  });

  it("does not rotate but does support resize", () => {
    expect(tableObjectType.supportsRotation).toBe(false);
    expect(tableObjectType.supportsResize).toBe(true);
  });
});

describe("resizeColumn / resizeRow", () => {
  it("replaces the target column width and leaves others unchanged", () => {
    const data = makeTableData();
    const updated = resizeColumn(data, 1, 80);
    expect(updated.columnWidths).toEqual([50, 80]);
    expect(data.columnWidths).toEqual([50, 50]); // original untouched
  });

  it("replaces the target row height and leaves others unchanged", () => {
    const data = makeTableData();
    const updated = resizeRow(data, 0, 40);
    expect(updated.rowHeights).toEqual([40, 20]);
  });

  it("rejects an out-of-range column index and a non-positive width", () => {
    const data = makeTableData();
    expect(() => resizeColumn(data, 5, 80)).toThrow();
    expect(() => resizeColumn(data, 0, 0)).toThrow();
    expect(() => resizeColumn(data, 0, -10)).toThrow();
  });

  it("rejects an out-of-range row index and a non-positive height", () => {
    const data = makeTableData();
    expect(() => resizeRow(data, -1, 10)).toThrow();
    expect(() => resizeRow(data, 0, 0)).toThrow();
  });
});

describe("isMergedInteriorSegment", () => {
  it("hides only the segment of a divider line that actually runs through a partial merge", () => {
    // 3x3 grid, merge covers only row 0's two leftmost cells — the col-1 divider must be
    // hidden for row 0 but still drawn for rows 1 and 2, which were never part of the merge.
    const ranges = [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }];
    expect(isMergedInteriorSegment(ranges, "col", 1, 0)).toBe(true);
    expect(isMergedInteriorSegment(ranges, "col", 1, 1)).toBe(false);
    expect(isMergedInteriorSegment(ranges, "col", 1, 2)).toBe(false);
  });

  it("mirrors the same partial-hiding behavior for a row-spanning merge", () => {
    const ranges = [{ row: 0, col: 0, rowSpan: 2, colSpan: 1 }];
    expect(isMergedInteriorSegment(ranges, "row", 1, 0)).toBe(true);
    expect(isMergedInteriorSegment(ranges, "row", 1, 1)).toBe(false);
  });

  it("is false for a boundary outside the merge's own axis span", () => {
    const ranges = [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }];
    expect(isMergedInteriorSegment(ranges, "col", 2, 0)).toBe(false);
  });
});

describe("mergeCells / splitMergedCell", () => {
  it("merges a range, keeps the anchor cell's content, and clears covered cells", () => {
    const data = makeTableData();
    const merged = mergeCells(data, { row: 0, col: 0, rowSpan: 2, colSpan: 2 });
    expect(merged.mergedRanges).toEqual([{ row: 0, col: 0, rowSpan: 2, colSpan: 2 }]);
    expect(merged.cells[0]![0]).toBe("a"); // anchor cell content preserved
    expect(merged.cells[0]![1]).toBeNull();
    expect(merged.cells[1]![0]).toBeNull();
    expect(merged.cells[1]![1]).toBeNull();
    // original data untouched
    expect(data.cells[0]![1]).toBe("b");
  });

  it("rejects a merge range extending outside the grid", () => {
    const data = makeTableData();
    expect(() => mergeCells(data, { row: 0, col: 0, rowSpan: 5, colSpan: 1 })).toThrow();
    expect(() => mergeCells(data, { row: 0, col: 0, rowSpan: 1, colSpan: 5 })).toThrow();
  });

  it("rejects a merge range overlapping an existing merge", () => {
    const data = mergeCells(makeTableData(), { row: 0, col: 0, rowSpan: 1, colSpan: 2 });
    expect(() => mergeCells(data, { row: 0, col: 1, rowSpan: 1, colSpan: 1 })).toThrow();
  });

  it("rejects a non-positive span", () => {
    const data = makeTableData();
    expect(() => mergeCells(data, { row: 0, col: 0, rowSpan: 0, colSpan: 1 })).toThrow();
  });

  it("splitMergedCell removes the merge covering the given cell", () => {
    const merged = mergeCells(makeTableData(), { row: 0, col: 0, rowSpan: 2, colSpan: 2 });
    const split = splitMergedCell(merged, 1, 1);
    expect(split.mergedRanges).toEqual([]);
  });

  it("splitMergedCell is a no-op when the cell isn't part of any merge", () => {
    const data = makeTableData();
    const result = splitMergedCell(data, 0, 0);
    expect(result.mergedRanges).toEqual([]);
  });
});
