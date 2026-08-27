import SpreadsheetPreview from '../../../components/preview/SpreadsheetPreview.vue';
import { useSettingsStore } from '../../../stores/settings.store';
import type { FilePreviewProvider } from '../types';

const spreadsheetPattern = /\.xlsx$/i;

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
    const settingsStore = useSettingsStore();
    const [{ parseXlsxPreview }, response] = await Promise.all([import('../xlsxPreviewParser'), context.fetchInline()]);
    const buffer = await response.arrayBuffer();
    const sheets = await parseXlsxPreview(buffer, {
      maxRows: settingsStore.spreadsheetPreviewMaxRowsNumber,
      maxColumns: settingsStore.spreadsheetPreviewMaxColumnsNumber,
    });

    return {
      componentProps: { sheets },
    };
  },
};
