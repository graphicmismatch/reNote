import { Container, Graphics } from "pixi.js";
import type { TableData, TableObject } from "@renote/core";
import type { ChunkOrigin, ObjectTypeDefinition } from "./object-type-definition.js";

// Re-exported so callers can `import { TableObject } from "@renote/canvas-engine"` without also
// reaching into "@renote/core" — same pattern as text-box-object-type.ts's re-export, since
// TableObject/TableData carry no engine-only fields.
export type { TableObject, TableData };

const GRID_COLOR = 0xb0b0b0;
const BORDER_COLOR = 0x707070;
const CELL_MARKER_COLOR = 0x9a9a9a;

type MergedRange = TableData["mergedRanges"][number];

function validateMergedRange(value: unknown, index: number): MergedRange {
  if (typeof value !== "object" || value === null) {
    throw new Error(`table data.mergedRanges[${index}] must be an object.`);
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.row !== "number" ||
    typeof candidate.col !== "number" ||
    typeof candidate.rowSpan !== "number" ||
    typeof candidate.colSpan !== "number"
  ) {
    throw new Error(`table data.mergedRanges[${index}] must have numeric row/col/rowSpan/colSpan.`);
  }
  return {
    row: candidate.row,
    col: candidate.col,
    rowSpan: candidate.rowSpan,
    colSpan: candidate.colSpan,
  };
}

function validateTableData(data: unknown): TableData {
  if (typeof data !== "object" || data === null) {
    throw new Error("table data must be an object.");
  }
  const candidate = data as Record<string, unknown>;
  if (!Array.isArray(candidate.columnWidths) || !candidate.columnWidths.every((w) => typeof w === "number")) {
    throw new Error("table data.columnWidths must be an array of numbers.");
  }
  if (!Array.isArray(candidate.rowHeights) || !candidate.rowHeights.every((h) => typeof h === "number")) {
    throw new Error("table data.rowHeights must be an array of numbers.");
  }
  if (!Array.isArray(candidate.cells) || !candidate.cells.every((row) => Array.isArray(row))) {
    throw new Error("table data.cells must be a 2D array.");
  }
  if (!Array.isArray(candidate.mergedRanges)) {
    throw new Error("table data.mergedRanges must be an array.");
  }
  return {
    columnWidths: candidate.columnWidths as number[],
    rowHeights: candidate.rowHeights as number[],
    cells: candidate.cells as unknown[][],
    mergedRanges: candidate.mergedRanges.map((r, i) => validateMergedRange(r, i)),
  };
}

/**
 * Cumulative boundaries for a set of sizes, scaled so they sum exactly to `targetTotal`.
 *
 * Design decision (documented per the task spec): `columnWidths`/`rowHeights` are treated as
 * *proportions* relative to each other, not literal page-unit sizes independent of `bounds`.
 * If they already sum to the bounds dimension, this is a no-op (scale factor 1). If they don't
 * (e.g. after a resize changed `bounds.width` without updating `columnWidths`, or hand-authored
 * test data), boundaries are scaled proportionally so the grid never draws outside `bounds` —
 * rather than drawing the raw sizes and overflowing/underflowing the object's own bounds rect.
 * Returns `sizes.length + 1` boundaries: `[0, ...cumulative, targetTotal]` relative to the
 * object's local axis (caller adds `bounds.x`/`bounds.y` to get page-space coordinates).
 */
function scaledBoundaries(sizes: readonly number[], targetTotal: number): number[] {
  const rawTotal = sizes.reduce((sum, s) => sum + s, 0);
  const scale = rawTotal > 0 ? targetTotal / rawTotal : 0;
  const boundaries: number[] = [0];
  let acc = 0;
  for (const size of sizes) {
    acc += size * scale;
    boundaries.push(acc);
  }
  return boundaries;
}

/**
 * True if the grid-line *segment* at `boundaryIndex` along `axis`, spanning the single
 * row/column `cellIndex` on the other axis, falls strictly inside a merged region.
 *
 * This is deliberately per-segment rather than per-line: a merge only spans part of the grid
 * along its cross-axis, so only the segments of the divider line that actually run through the
 * merged region should be hidden — segments of the same line outside the merge's row/column
 * span still belong to unmerged cells and must still be drawn. E.g. on a 3x3 grid, a merge of
 * `{row: 0, col: 0, rowSpan: 1, colSpan: 2}` only hides the col-1 divider for row 0; rows 1 and
 * 2 still show it, since they were never part of that merge.
 */
export function isMergedInteriorSegment(
  mergedRanges: readonly MergedRange[],
  axis: "row" | "col",
  boundaryIndex: number,
  cellIndex: number,
): boolean {
  for (const range of mergedRanges) {
    const start = axis === "row" ? range.row : range.col;
    const span = axis === "row" ? range.rowSpan : range.colSpan;
    const end = start + span;
    // The divider line must be strictly interior to the merge along its own axis...
    if (!(boundaryIndex > start && boundaryIndex < end)) continue;
    // ...and the segment's cross-axis cell must fall within the merge's cross-axis span.
    const crossStart = axis === "row" ? range.col : range.row;
    const crossSpan = axis === "row" ? range.colSpan : range.rowSpan;
    if (cellIndex >= crossStart && cellIndex < crossStart + crossSpan) {
      return true;
    }
  }
  return false;
}

/** True if cell (row, col) is covered by a merge but is not that merge's top-left anchor cell. */
function isCoveredNonAnchorCell(mergedRanges: readonly MergedRange[], row: number, col: number): boolean {
  for (const range of mergedRanges) {
    const withinRows = row >= range.row && row < range.row + range.rowSpan;
    const withinCols = col >= range.col && col < range.col + range.colSpan;
    if (withinRows && withinCols) {
      return !(row === range.row && col === range.col);
    }
  }
  return false;
}

interface TableView extends Container {
  grid: Graphics;
  markers: Graphics;
}

function isTableView(view: Container): view is TableView {
  return "grid" in view && "markers" in view;
}

export const tableObjectType: ObjectTypeDefinition<"table", TableData> = {
  type: "table",

  validate: validateTableData,

  createView(object, origin): Container {
    const container = new Container() as TableView;
    const grid = new Graphics();
    const markers = new Graphics();
    container.addChild(grid);
    container.addChild(markers);
    container.grid = grid;
    container.markers = markers;
    drawTableView(container, object, origin);
    return container;
  },

  updateView(view, object, origin): void {
    if (isTableView(view)) {
      drawTableView(view, object, origin);
    }
  },

  hitTest(object, point): boolean {
    const { x, y, width, height } = object.bounds;
    return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
  },

  supportsRotation: false,
  supportsResize: true,
};

/**
 * Geometry is baked in chunk-local space: `object.bounds` (world space) minus `origin` (the
 * containing chunk's world-space offset — see PixiRenderer's chunk-container doc comment) —
 * `PixiRenderer` applies `transform.x/y/rotation/scale` on top generically, this function never
 * touches those.
 */
function drawTableView(view: TableView, object: TableObject, origin: ChunkOrigin): void {
  const x = object.bounds.x - origin.x;
  const y = object.bounds.y - origin.y;
  const { width, height } = object.bounds;
  const { columnWidths, rowHeights, cells, mergedRanges } = object.data;

  view.grid.clear();
  view.grid.rect(x, y, width, height).stroke({ width: 1, color: BORDER_COLOR });

  const colBoundaries = scaledBoundaries(columnWidths, width);
  const rowBoundaries = scaledBoundaries(rowHeights, height);

  // Vertical interior lines, drawn per row-segment rather than as one full-height line, so a
  // merge that only spans some rows only hides the segments actually inside it (see
  // isMergedInteriorSegment's doc comment).
  for (let col = 1; col < colBoundaries.length - 1; col += 1) {
    const lineX = x + colBoundaries[col]!;
    for (let row = 0; row < rowBoundaries.length - 1; row += 1) {
      if (isMergedInteriorSegment(mergedRanges, "col", col, row)) continue;
      const segY1 = y + rowBoundaries[row]!;
      const segY2 = y + rowBoundaries[row + 1]!;
      view.grid.moveTo(lineX, segY1).lineTo(lineX, segY2).stroke({ width: 1, color: GRID_COLOR });
    }
  }

  // Horizontal interior lines, drawn per column-segment for the same reason.
  for (let row = 1; row < rowBoundaries.length - 1; row += 1) {
    const lineY = y + rowBoundaries[row]!;
    for (let col = 0; col < colBoundaries.length - 1; col += 1) {
      if (isMergedInteriorSegment(mergedRanges, "row", row, col)) continue;
      const segX1 = x + colBoundaries[col]!;
      const segX2 = x + colBoundaries[col + 1]!;
      view.grid.moveTo(segX1, lineY).lineTo(segX2, lineY).stroke({ width: 1, color: GRID_COLOR });
    }
  }

  // Cell-content placeholder: a small dot per non-empty, non-covered cell — proves data flows
  // through without attempting real rich-text rendering (packages/text-editor's job, unreachable
  // from this package).
  view.markers.clear();
  for (let row = 0; row < rowHeights.length; row += 1) {
    for (let col = 0; col < columnWidths.length; col += 1) {
      if (isCoveredNonAnchorCell(mergedRanges, row, col)) continue;
      const content = cells[row]?.[col];
      if (content === undefined || content === null) continue;
      const cellX = x + (colBoundaries[col] ?? 0);
      const cellY = y + (rowBoundaries[row] ?? 0);
      view.markers.circle(cellX + 6, cellY + 6, 2).fill({ color: CELL_MARKER_COLOR });
    }
  }
}

/** Validates a column/row index is within range, throwing a clear error otherwise. */
function requireIndexInRange(index: number, length: number, label: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new Error(`table ${label} index ${index} is out of range (0..${length - 1}).`);
  }
}

function requirePositiveSize(size: number, label: string): void {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`table ${label} size must be a positive number, got ${size}.`);
  }
}

/** Pure helper: returns `data` with `columnWidths[columnIndex]` replaced by `newWidth`. */
export function resizeColumn(data: TableData, columnIndex: number, newWidth: number): TableData {
  requireIndexInRange(columnIndex, data.columnWidths.length, "column");
  requirePositiveSize(newWidth, "column width");
  const columnWidths = data.columnWidths.slice();
  columnWidths[columnIndex] = newWidth;
  return { ...data, columnWidths };
}

/** Pure helper: returns `data` with `rowHeights[rowIndex]` replaced by `newHeight`. */
export function resizeRow(data: TableData, rowIndex: number, newHeight: number): TableData {
  requireIndexInRange(rowIndex, data.rowHeights.length, "row");
  requirePositiveSize(newHeight, "row height");
  const rowHeights = data.rowHeights.slice();
  rowHeights[rowIndex] = newHeight;
  return { ...data, rowHeights };
}

function rangesOverlap(a: MergedRange, b: MergedRange): boolean {
  const aRowEnd = a.row + a.rowSpan;
  const aColEnd = a.col + a.colSpan;
  const bRowEnd = b.row + b.rowSpan;
  const bColEnd = b.col + b.colSpan;
  return a.row < bRowEnd && aRowEnd > b.row && a.col < bColEnd && aColEnd > b.col;
}

/**
 * Pure helper: merges the cells in `range` into a single logical cell.
 *
 * Cell-content collapsing decision (documented per the task spec): the merge keeps the top-left
 * cell's existing content as the merged cell's content (it's what `mergedRanges` + the grid
 * renderer treat as the merge's anchor). The other cells covered by the merge have their content
 * cleared to `null` rather than concatenated or discarded silently — `null` is a stable "empty"
 * sentinel `cells[row][col]` can hold (consistent with how `drawTableView`/`isCoveredNonAnchorCell`
 * skip rendering anything for covered non-anchor cells), and clearing (rather than concatenating
 * rich-text docs from multiple cells, which would require understanding the opaque rich-text
 * schema this package explicitly doesn't parse) avoids inventing an ad hoc content-merge policy
 * that packages/text-editor doesn't know about.
 */
export function mergeCells(data: TableData, range: MergedRange): TableData {
  if (
    !Number.isInteger(range.row) ||
    !Number.isInteger(range.col) ||
    !Number.isInteger(range.rowSpan) ||
    !Number.isInteger(range.colSpan) ||
    range.rowSpan <= 0 ||
    range.colSpan <= 0
  ) {
    throw new Error("table mergeCells range must have non-negative integer row/col and positive spans.");
  }
  if (range.row < 0 || range.col < 0) {
    throw new Error("table mergeCells range row/col must be non-negative.");
  }
  if (
    range.row + range.rowSpan > data.rowHeights.length ||
    range.col + range.colSpan > data.columnWidths.length
  ) {
    throw new Error("table mergeCells range extends outside the grid.");
  }
  for (const existing of data.mergedRanges) {
    if (rangesOverlap(existing, range)) {
      throw new Error("table mergeCells range overlaps an existing merged range.");
    }
  }

  const cells = data.cells.map((row) => row.slice());
  for (let row = range.row; row < range.row + range.rowSpan; row += 1) {
    for (let col = range.col; col < range.col + range.colSpan; col += 1) {
      if (row === range.row && col === range.col) continue;
      if (cells[row]) cells[row]![col] = null;
    }
  }

  return { ...data, cells, mergedRanges: [...data.mergedRanges, { ...range }] };
}

/** Pure helper: removes whichever merged range (if any) covers cell (row, col). No-op if none does. */
export function splitMergedCell(data: TableData, row: number, col: number): TableData {
  const mergedRanges = data.mergedRanges.filter((range) => {
    const withinRows = row >= range.row && row < range.row + range.rowSpan;
    const withinCols = col >= range.col && col < range.col + range.colSpan;
    return !(withinRows && withinCols);
  });
  return { ...data, mergedRanges };
}
