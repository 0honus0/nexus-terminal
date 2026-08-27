import { read, utils, type CellObject, type ColInfo, type RowInfo, type WorkSheet } from 'xlsx';

export interface ParsedSpreadsheetSheet {
  name: string;
  rows: unknown[][];
  totalRows: number;
  totalColumns: number;
  displayedRows: number;
  displayedColumns: number;
  startRow: number;
  columnWidths: Array<number | null>;
  rowHeights: Array<number | null>;
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

const parseSheet = (
  name: string,
  worksheet: WorkSheet,
  maxRows: number,
  maxColumns: number,
): ParsedSpreadsheetSheet => {
  // With sheetRows enabled, SheetJS stores the truncated range in !ref and the
  // original self-reported worksheet range in !fullref. XLSX files provide this
  // metadata, which lets the preview disclose the real dimensions even when only
  // the first rows are parsed.
  const fullRange = decodeRange(worksheet['!fullref'] as string | undefined) ?? decodeRange(worksheet['!ref']);
  const parsedRange = decodeRange(worksheet['!ref']) ?? fullRange;

  if (!fullRange || !parsedRange) {
    return {
      name,
      rows: [],
      totalRows: 0,
      totalColumns: 0,
      displayedRows: 0,
      displayedColumns: 0,
      startRow: 0,
      columnWidths: [],
      rowHeights: [],
    };
  }

  const totalRows = Math.max(0, fullRange.e.r - fullRange.s.r + 1);
  const totalColumns = Math.max(0, fullRange.e.c - fullRange.s.c + 1);
  const parsedRows = Math.max(0, parsedRange.e.r - fullRange.s.r + 1);
  const displayedRows = Math.min(totalRows, maxRows, parsedRows);
  const displayedColumns = Math.min(totalColumns, maxColumns);
  const denseData = worksheet['!data'] ?? [];
  const rows: unknown[][] = [];

  for (let rowOffset = 0; rowOffset < displayedRows; rowOffset += 1) {
    const sourceRow = fullRange.s.r + rowOffset;
    const row: unknown[] = [];
    for (let columnOffset = 0; columnOffset < displayedColumns; columnOffset += 1) {
      const sourceColumn = fullRange.s.c + columnOffset;
      row.push(formatCell(denseData[sourceRow]?.[sourceColumn]));
    }
    rows.push(row);
  }

  const columnInfo = worksheet['!cols'] ?? [];
  const rowInfo = worksheet['!rows'] ?? [];
  const columnWidths = Array.from({ length: displayedColumns }, (_, offset) => (
    columnWidthPx(columnInfo[fullRange.s.c + offset])
  ));
  const rowHeights = Array.from({ length: displayedRows }, (_, offset) => (
    rowHeightPx(rowInfo[fullRange.s.r + offset])
  ));

  return {
    name,
    rows,
    totalRows,
    totalColumns,
    displayedRows,
    displayedColumns,
    startRow: fullRange.s.r,
    columnWidths,
    rowHeights,
  };
};

export const parseXlsxPreview = async (
  buffer: ArrayBuffer,
  options: { maxRows: number; maxColumns: number },
): Promise<ParsedSpreadsheetSheet[]> => {
  const workbook = read(buffer, {
    type: 'array',
    dense: true,
    sheetRows: options.maxRows,
    cellStyles: true,
    cellDates: true,
    cellHTML: false,
    cellFormula: false,
    cellText: true,
  });

  const sheets = workbook.SheetNames
    .map((name) => {
      const worksheet = workbook.Sheets[name];
      return worksheet ? parseSheet(name, worksheet, options.maxRows, options.maxColumns) : null;
    })
    .filter((sheet): sheet is ParsedSpreadsheetSheet => sheet !== null);

  if (sheets.length === 0) {
    throw new Error('Invalid XLSX file: no worksheets were found.');
  }

  return sheets;
};
