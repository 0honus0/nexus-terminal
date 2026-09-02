import SpreadsheetPreview from '../../../components/preview/SpreadsheetPreview.vue';
import { useSettingsStore } from '../../../stores/settings.store';
import type { FilePreviewProvider } from '../types';

const spreadsheetPattern = /\.xlsx$/i;
const loadSpreadsheetParser = () => import('../xlsxPreviewParser');

export const spreadsheetPreviewProvider: FilePreviewProvider = {
  id: 'spreadsheet',
  priority: 80,
  maxInlineSize: 10 * 1024 * 1024,

  canPreview(file) {
    return file.attrs.isFile && spreadsheetPattern.test(file.filename);
  },

  async preload() {
    await loadSpreadsheetParser();
  },

  preview() {
    return SpreadsheetPreview;
  },

  async load(_file, context) {
    const settingsStore = useSettingsStore();
    const [{ parseXlsxPreview }, response] = await Promise.all([loadSpreadsheetParser(), context.fetchInline()]);
    const buffer = await response.arrayBuffer();
    const sheets = await parseXlsxPreview(buffer, {
      maxColumns: settingsStore.spreadsheetPreviewMaxColumnsNumber,
    });

    return {
      componentProps: {
        sheets,
        rowsPerPage: settingsStore.spreadsheetPreviewRowsPerPageNumber,
      },
    };
  },
};
