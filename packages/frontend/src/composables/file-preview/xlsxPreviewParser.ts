export interface ParsedSpreadsheetSheet {
  name: string;
  rows: unknown[][];
  totalRows: number;
  totalColumns: number;
}

interface ZipEntry {
  compression: number;
  compressedSize: number;
  localHeaderOffset: number;
}

const textDecoder = new TextDecoder('utf-8');

const uint16 = (view: DataView, offset: number) => view.getUint16(offset, true);
const uint32 = (view: DataView, offset: number) => view.getUint32(offset, true);

const findEndOfCentralDirectory = (view: DataView): number => {
  const minimumOffset = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (uint32(view, offset) === 0x06054b50) return offset;
  }
  throw new Error('Invalid XLSX archive: end-of-central-directory record not found.');
};

const parseZipDirectory = (buffer: ArrayBuffer): Map<string, ZipEntry> => {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const entryCount = uint16(view, eocdOffset + 10);
  let offset = uint32(view, eocdOffset + 16);
  const entries = new Map<string, ZipEntry>();

  for (let index = 0; index < entryCount; index += 1) {
    if (uint32(view, offset) !== 0x02014b50) {
      throw new Error('Invalid XLSX archive: central-directory entry is malformed.');
    }

    const compression = uint16(view, offset + 10);
    const compressedSize = uint32(view, offset + 20);
    const fileNameLength = uint16(view, offset + 28);
    const extraLength = uint16(view, offset + 30);
    const commentLength = uint16(view, offset + 32);
    const localHeaderOffset = uint32(view, offset + 42);
    const fileName = textDecoder.decode(bytes.subarray(offset + 46, offset + 46 + fileNameLength));

    entries.set(fileName, {
      compression,
      compressedSize,
      localHeaderOffset,
    });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
};

const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support XLSX decompression.');
  }

  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const readZipEntry = async (
  buffer: ArrayBuffer,
  entries: Map<string, ZipEntry>,
  name: string,
): Promise<Uint8Array | null> => {
  const entry = entries.get(name);
  if (!entry) return null;

  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const offset = entry.localHeaderOffset;
  if (uint32(view, offset) !== 0x04034b50) {
    throw new Error(`Invalid XLSX archive: local header for ${name} is malformed.`);
  }

  const fileNameLength = uint16(view, offset + 26);
  const extraLength = uint16(view, offset + 28);
  const dataOffset = offset + 30 + fileNameLength + extraLength;
  const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);

  if (entry.compression === 0) return new Uint8Array(compressed);
  if (entry.compression === 8) return inflateRaw(compressed);
  throw new Error(`Unsupported XLSX compression method ${entry.compression}.`);
};

const readXml = async (buffer: ArrayBuffer, entries: Map<string, ZipEntry>, name: string): Promise<Document | null> => {
  const data = await readZipEntry(buffer, entries, name);
  if (!data) return null;

  const xml = new DOMParser().parseFromString(textDecoder.decode(data), 'application/xml');
  if (xml.querySelector('parsererror')) {
    throw new Error(`Invalid XLSX XML in ${name}.`);
  }
  return xml;
};

const normalizeWorkbookTarget = (target: string): string => {
  const cleanTarget = target.replace(/^\//, '');
  const segments = (cleanTarget.startsWith('xl/') ? cleanTarget : `xl/${cleanTarget}`).split('/');
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') normalized.pop();
    else normalized.push(segment);
  }
  return normalized.join('/');
};

const columnIndexFromReference = (reference: string): number => {
  const match = reference.match(/^([A-Z]+)/i);
  if (!match) return 0;
  let result = 0;
  for (const char of match[1].toUpperCase()) {
    result = result * 26 + char.charCodeAt(0) - 64;
  }
  return Math.max(0, result - 1);
};

const parseDimension = (document: Document): { rows: number; columns: number } | null => {
  const ref = document.querySelector('dimension')?.getAttribute('ref');
  if (!ref) return null;
  const end = ref.split(':').at(-1);
  if (!end) return null;
  const rowMatch = end.match(/(\d+)$/);
  return {
    rows: rowMatch ? Number(rowMatch[1]) : 0,
    columns: columnIndexFromReference(end) + 1,
  };
};

const getTextContent = (element: Element | null): string => {
  if (!element) return '';
  return Array.from(element.querySelectorAll('t'))
    .map((node) => node.textContent ?? '')
    .join('');
};

const parseSharedStrings = (document: Document | null): string[] => {
  if (!document) return [];
  return Array.from(document.querySelectorAll('si')).map((item) => getTextContent(item));
};

const parseCellValue = (cell: Element, sharedStrings: string[]): unknown => {
  const type = cell.getAttribute('t');
  if (type === 'inlineStr') return getTextContent(cell.querySelector('is'));

  const raw = cell.querySelector('v')?.textContent ?? '';
  if (type === 's') return sharedStrings[Number(raw)] ?? '';
  if (type === 'b') return raw === '1';
  if (type === 'str' || type === 'e' || type === 'd') return raw;
  if (raw === '') return '';

  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw;
};

const parseWorksheet = (
  document: Document,
  sharedStrings: string[],
  maxRows: number,
  maxColumns: number,
): { rows: unknown[][]; totalRows: number; totalColumns: number } => {
  const dimension = parseDimension(document);
  const rows: unknown[][] = [];
  let observedRows = 0;
  let observedColumns = 0;

  for (const rowElement of Array.from(document.querySelectorAll('sheetData > row'))) {
    const rowNumber = Number(rowElement.getAttribute('r')) || observedRows + 1;
    observedRows = Math.max(observedRows, rowNumber);
    if (rowNumber > maxRows) continue;

    const row: unknown[] = [];
    for (const cell of Array.from(rowElement.querySelectorAll(':scope > c'))) {
      const reference = cell.getAttribute('r') ?? 'A1';
      const columnIndex = columnIndexFromReference(reference);
      observedColumns = Math.max(observedColumns, columnIndex + 1);
      if (columnIndex >= maxColumns) continue;
      row[columnIndex] = parseCellValue(cell, sharedStrings);
    }

    const targetLength = Math.min(
      Math.max(row.length, Math.min(dimension?.columns ?? observedColumns, maxColumns)),
      maxColumns,
    );
    while (row.length < targetLength) row.push('');
    rows[rowNumber - 1] = row;
  }

  const visibleRows = Math.min(Math.max(rows.length, Math.min(dimension?.rows ?? observedRows, maxRows)), maxRows);
  while (rows.length < visibleRows) rows.push([]);

  return {
    rows,
    totalRows: Math.max(dimension?.rows ?? 0, observedRows),
    totalColumns: Math.max(dimension?.columns ?? 0, observedColumns),
  };
};

export const parseXlsxPreview = async (
  buffer: ArrayBuffer,
  options: { maxRows: number; maxColumns: number },
): Promise<ParsedSpreadsheetSheet[]> => {
  const entries = parseZipDirectory(buffer);
  const [workbook, relationships, sharedStringsDocument] = await Promise.all([
    readXml(buffer, entries, 'xl/workbook.xml'),
    readXml(buffer, entries, 'xl/_rels/workbook.xml.rels'),
    readXml(buffer, entries, 'xl/sharedStrings.xml'),
  ]);

  if (!workbook || !relationships) {
    throw new Error('Invalid XLSX file: workbook metadata is missing.');
  }

  const relationshipTargets = new Map<string, string>();
  for (const relationship of Array.from(relationships.querySelectorAll('Relationship'))) {
    const id = relationship.getAttribute('Id');
    const target = relationship.getAttribute('Target');
    if (id && target) relationshipTargets.set(id, normalizeWorkbookTarget(target));
  }

  const sharedStrings = parseSharedStrings(sharedStringsDocument);
  const sheets: ParsedSpreadsheetSheet[] = [];

  for (const sheet of Array.from(workbook.querySelectorAll('sheets > sheet'))) {
    const name = sheet.getAttribute('name') ?? `Sheet ${sheets.length + 1}`;
    const relationshipId =
      sheet.getAttribute('r:id') ??
      sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    if (!relationshipId) continue;

    const worksheetPath = relationshipTargets.get(relationshipId);
    if (!worksheetPath) continue;
    const worksheet = await readXml(buffer, entries, worksheetPath);
    if (!worksheet) continue;

    sheets.push({
      name,
      ...parseWorksheet(worksheet, sharedStrings, options.maxRows, options.maxColumns),
    });
  }

  if (sheets.length === 0) {
    throw new Error('Invalid XLSX file: no worksheets were found.');
  }

  return sheets;
};
