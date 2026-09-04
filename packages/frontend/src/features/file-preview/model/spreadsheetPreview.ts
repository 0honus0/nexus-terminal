import { read, utils, type CellObject, type ColInfo, type RowInfo, type WorkSheet } from 'xlsx';

export interface SpreadsheetSearchMatch {
  sheetIndex: number;
  rowIndex: number;
  colIndex: number;
}

export interface ParsedSpreadsheetSheet {
  name: string;
  totalRows: number;
  totalColumns: number;
  displayedColumns: number;
  startRow: number;
  startColumn: number;
  columnWidths: Array<number | null>;
  rowHeights: Array<number | null>;
  page(start: number, count: number): string[][];
  search(query: string, limit?: number): Array<Omit<SpreadsheetSearchMatch, 'sheetIndex'>>;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const cellText = (cell: CellObject | undefined): string => {
  if (!cell) return '';
  if (typeof cell.w === 'string') return cell.w;
  if (cell.v == null) return '';
  if (cell.v instanceof Date) return cell.v.toLocaleString();
  return String(cell.v);
};

const cellAt = (sheet: WorkSheet, row: number, column: number): CellObject | undefined => {
  const dense = (sheet as WorkSheet & { '!data'?: Array<Array<CellObject | undefined>> })['!data'];
  return dense?.[row]?.[column] ?? (sheet[utils.encode_cell({ r: row, c: column })] as CellObject | undefined);
};

const columnWidth = (sheet: WorkSheet, column: number): number | null => {
  const definition = (sheet['!cols'] as Array<ColInfo | undefined> | undefined)?.[column];
  if (!definition || definition.hidden) return null;
  const width =
    typeof definition.wpx === 'number'
      ? definition.wpx
      : typeof definition.wch === 'number'
        ? definition.wch * 7 + 12
        : typeof definition.width === 'number'
          ? definition.width * 7 + 12
          : null;
  if (width === null || !Number.isFinite(width) || width <= 0) return null;
  return Math.round(clamp(width, 48, 480));
};

const rowHeight = (sheet: WorkSheet, row: number): number | null => {
  const definition = (sheet['!rows'] as Array<RowInfo | undefined> | undefined)?.[row];
  if (!definition || definition.hidden) return null;
  const height =
    typeof definition.hpx === 'number'
      ? definition.hpx
      : typeof definition.hpt === 'number'
        ? definition.hpt * (96 / 72)
        : null;
  if (height === null || !Number.isFinite(height) || height <= 0) return null;
  return Math.round(clamp(height, 20, 240));
};

const parseSheet = (name: string, sheet: WorkSheet, maxColumns: number): ParsedSpreadsheetSheet => {
  const reference = sheet['!ref'];
  if (!reference) {
    return {
      name,
      totalRows: 0,
      totalColumns: 0,
      displayedColumns: 0,
      startRow: 0,
      startColumn: 0,
      columnWidths: [],
      rowHeights: [],
      page: () => [],
      search: () => [],
    };
  }

  let range: ReturnType<typeof utils.decode_range>;
  try {
    range = utils.decode_range(reference);
  } catch {
    return {
      name,
      totalRows: 0,
      totalColumns: 0,
      displayedColumns: 0,
      startRow: 0,
      startColumn: 0,
      columnWidths: [],
      rowHeights: [],
      page: () => [],
      search: () => [],
    };
  }
  const totalRows = Math.max(0, range.e.r - range.s.r + 1);
  const totalColumns = Math.max(0, range.e.c - range.s.c + 1);
  const displayedColumns = Math.min(totalColumns, maxColumns);
  const columnWidths = Array.from({ length: displayedColumns }, (_, index) => columnWidth(sheet, range.s.c + index));
  const rowHeights = Array.from({ length: totalRows }, (_, index) => rowHeight(sheet, range.s.r + index));

  const readRow = (relativeRow: number): string[] => {
    const sourceRow = range.s.r + relativeRow;
    return Array.from({ length: displayedColumns }, (_, relativeColumn) =>
      cellText(cellAt(sheet, sourceRow, range.s.c + relativeColumn)),
    );
  };

  return {
    name,
    totalRows,
    totalColumns,
    displayedColumns,
    startRow: range.s.r,
    startColumn: range.s.c,
    columnWidths,
    rowHeights,
    page(start, count) {
      const from = clamp(Math.trunc(start), 0, totalRows);
      const to = clamp(from + Math.max(0, Math.trunc(count)), 0, totalRows);
      return Array.from({ length: Math.max(0, to - from) }, (_, index) => readRow(from + index));
    },
    search(query, limit = 10_000) {
      const needle = query.trim().toLocaleLowerCase();
      if (!needle) return [];
      const matches: Array<Omit<SpreadsheetSearchMatch, 'sheetIndex'>> = [];
      for (let rowIndex = 0; rowIndex < totalRows && matches.length < limit; rowIndex += 1) {
        const row = readRow(rowIndex);
        for (let colIndex = 0; colIndex < row.length && matches.length < limit; colIndex += 1) {
          if (row[colIndex]!.toLocaleLowerCase().includes(needle)) matches.push({ rowIndex, colIndex });
        }
      }
      return matches;
    },
  };
};

export const parseSpreadsheetPreview = (bytes: ArrayBuffer, maxColumns: number): ParsedSpreadsheetSheet[] => {
  const workbook = read(bytes, {
    type: 'array',
    dense: true,
    cellStyles: true,
    cellDates: true,
    cellHTML: false,
    cellFormula: false,
    cellText: true,
  });
  const boundedColumns = clamp(Math.trunc(maxColumns) || 100, 5, 200);
  return workbook.SheetNames.flatMap((name) => {
    const sheet = workbook.Sheets[name];
    return sheet ? [parseSheet(name, sheet, boundedColumns)] : [];
  });
};
