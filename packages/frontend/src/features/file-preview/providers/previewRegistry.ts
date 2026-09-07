import type { PreviewKind } from '../model/preview';

const MEBIBYTE = 1024 * 1024;
// Remote SVG is intentionally excluded: an SVG can reference external resources.
const image = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']);
const sheets = new Set(['xlsx', 'xls', 'csv']);

export const previewKindFor = (path: string): PreviewKind => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (image.has(ext)) return 'image';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (sheets.has(ext)) return 'spreadsheet';
  if (ext === 'docx') return 'docx';
  return 'unsupported';
};

export const previewInlineLimit = (kind: PreviewKind): number | undefined => {
  if (kind === 'markdown') return 2 * MEBIBYTE;
  if (kind === 'spreadsheet') return 10 * MEBIBYTE;
  if (kind === 'image' || kind === 'pdf' || kind === 'docx') return 20 * MEBIBYTE;
  return undefined;
};
