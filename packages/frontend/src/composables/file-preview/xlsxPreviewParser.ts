import { read, utils, type CellObject, type ColInfo, type RowInfo, type WorkSheet } from 'xlsx';

export interface ParsedSpreadsheetPage {
  rows: unknown[][];
  displayedRows: number;
  startRow: number;
  rowHeights: Array<number | null>;
}

export interface ParsedSpreadsheetMatch {
  rowIndex: number;
  columnIndex: number;
}

export interface ParsedSpreadsheetSheet {
  name: string;
  totalRows: number;
  totalColumns: number;
  displayedColumns: number;
  columnWidths: Array<number | null>;
  getPage(pageIndex: number, rowsPerPage: number): ParsedSpreadsheetPage;
  findMatches(query: string, limit?: number): ParsedSpreadsheetMatch[];
}

const MIN_COLUMN_WIDTH_PX = 48;
const MAX_COLUMN_WIDTH_PX = 480;
const MIN_ROW_HEIGHT_PX = 20;
const MAX_ROW_HEIGHT_PX = 240;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const decodeRange = (reference?: string) => {
  if (!reference) return null;
  try {
    return utils.decode_range(reference);
  } catch {
    return null;
  }
};

const formatCell = (cell: CellObject | undefined): unknown => {
  if (!cell || cell.t === 'z') return '';
  if (typeof cell.w === 'string') return cell.w;
  return cell.v ?? '';
};

const columnWidthPx = (info: ColInfo | undefined): number | null => {
  if (!info || info.hidden) return null;
  const width =
    typeof info.wpx === 'number' ? info.wpx
      : typeof info.wch === 'number' ? (info.wch * 7) + 12
        : typeof info.width === 'number' ? (info.width * 7) + 12
          : null;
  if (width === null || !Number.isFinite(width) || width <= 0) return null;
  return Math.round(clamp(width, MIN_COLUMN_WIDTH_PX, MAX_COLUMN_WIDTH_PX));
};

const rowHeightPx = (info: RowInfo | undefined): number | null => {
  if (!info || info.hidden) return null;
  const height =
    typeof info.hpx === 'number' ? info.hpx
      : typeof info.hpt === 'number' ? info.hpt * (96 / 72)
        : null;
  if (height === null || !Number.isFinite(height) || height <= 0) return null;
  return Math.round(clamp(height, MIN_ROW_HEIGHT_PX, MAX_ROW_HEIGHT_PX));
};

const emptyPage = (): ParsedSpreadsheetPage => ({
  rows: [],
  displayedRows: 0,
  startRow: 0,
  rowHeights: [],
});

const parseSheet = (
  name: string,
  worksheet: WorkSheet,
  maxColumns: number,
): ParsedSpreadsheetSheet => {
  const fullRange = decodeRange(worksheet['!ref']);

  if (!fullRange) {
    return {
      name,
      totalRows: 0,
      totalColumns: 0,
      displayedColumns: 0,
      columnWidths: [],
      getPage: emptyPage,
      findMatches: () => [],
    };
  }

  const totalRows = Math.max(0, fullRange.e.r - fullRange.s.r + 1);
  const totalColumns = Math.max(0, fullRange.e.c - fullRange.s.c + 1);
  const displayedColumns = Math.min(totalColumns, maxColumns);
  const denseData = worksheet['!data'] ?? [];
  const columnInfo = worksheet['!cols'] ?? [];
  const rowInfo = worksheet['!rows'] ?? [];
  const columnWidths = Array.from({ length: displayedColumns }, (_, offset) => (
    columnWidthPx(columnInfo[fullRange.s.c + offset])
  ));

  const getPage = (pageIndex: number, rowsPerPage: number): ParsedSpreadsheetPage => {
    if (totalRows === 0) return emptyPage();

    const safeRowsPerPage = Math.max(1, Math.floor(rowsPerPage));
    const pageCount = Math.max(1, Math.ceil(totalRows / safeRowsPerPage));
    const safePageIndex = Math.min(pageCount - 1, Math.max(0, Math.floor(pageIndex)));
    const rowOffset = safePageIndex * safeRowsPerPage;
    const displayedRows = Math.min(safeRowsPerPage, totalRows - rowOffset);
    const startRow = fullRange.s.r + rowOffset;
    const rows: unknown[][] = [];

    for (let rowOffsetInPage = 0; rowOffsetInPage < displayedRows; rowOffsetInPage += 1) {
      const sourceRow = startRow + rowOffsetInPage;
      const row: unknown[] = [];
      for (let columnOffset = 0; columnOffset < displayedColumns; columnOffset += 1) {
        const sourceColumn = fullRange.s.c + columnOffset;
        row.push(formatCell(denseData[sourceRow]?.[sourceColumn]));
      }
      rows.push(row);
    }

    const rowHeights = Array.from({ length: displayedRows }, (_, offset) => (
      rowHeightPx(rowInfo[startRow + offset])
    ));

    return {
      rows,
      displayedRows,
      startRow,
      rowHeights,
    };
  };

  const findMatches = (query: string, limit = 10_000): ParsedSpreadsheetMatch[] => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle || totalRows === 0 || displayedColumns === 0 || limit <= 0) return [];

    const matches: ParsedSpreadsheetMatch[] = [];
    for (let rowIndex = 0; rowIndex < totalRows; rowIndex += 1) {
      const sourceRow = fullRange.s.r + rowIndex;
      for (let columnIndex = 0; columnIndex < displayedColumns; columnIndex += 1) {
        const sourceColumn = fullRange.s.c + columnIndex;
        const value = formatCell(denseData[sourceRow]?.[sourceColumn]);
        if (String(value).toLocaleLowerCase().includes(needle)) {
          matches.push({ rowIndex, columnIndex });
          if (matches.length >= limit) return matches;
        }
      }
    }
    return matches;
  };

  return {
    name,
    totalRows,
    totalColumns,
    displayedColumns,
    columnWidths,
    getPage,
    findMatches,
  };
};

export const parseXlsxPreview = async (
  buffer: ArrayBuffer,
  options: { maxColumns: number },
): Promise<ParsedSpreadsheetSheet[]> => {
  const workbook = read(buffer, {
    type: 'array',
    dense: true,
    cellStyles: true,
    cellDates: true,
    cellHTML: false,
    cellFormula: false,
    cellText: true,
  });

  const sheets = workbook.SheetNames
    .map((name) => {
      const worksheet = workbook.Sheets[name];
      return worksheet ? parseSheet(name, worksheet, options.maxColumns) : null;
    })
    .filter((sheet): sheet is ParsedSpreadsheetSheet => sheet !== null);

  if (sheets.length === 0) {
    throw new Error('Invalid XLSX file: no worksheets were found.');
  }

  return sheets;
};
