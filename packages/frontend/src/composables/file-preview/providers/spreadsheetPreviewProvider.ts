import SpreadsheetPreview from '../../../components/preview/SpreadsheetPreview.vue';
import type { FilePreviewProvider } from '../types';

const spreadsheetPattern = /\.xlsx$/i;
const MAX_PREVIEW_ROWS = 500;
const MAX_PREVIEW_COLUMNS = 100;

export const spreadsheetPreviewProvider: FilePreviewProvider = {
  id: 'spreadsheet',
  priority: 80,
  maxInlineSize: 10 * 1024 * 1024,

  canPreview(file) {
    return file.attrs.isFile && spreadsheetPattern.test(file.filename);
  },

  preview() {
    return SpreadsheetPreview;
  },

  async load(_file, context) {
    const [{ parseXlsxPreview }, response] = await Promise.all([import('../xlsxPreviewParser'), context.fetchInline()]);
    const buffer = await response.arrayBuffer();
    const sheets = await parseXlsxPreview(buffer, {
      maxRows: MAX_PREVIEW_ROWS,
      maxColumns: MAX_PREVIEW_COLUMNS,
    });

    return {
      componentProps: { sheets },
    };
  },
};
