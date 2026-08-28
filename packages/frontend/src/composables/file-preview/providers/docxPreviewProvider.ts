import { defineAsyncComponent } from 'vue';
import type { FilePreviewProvider } from '../types';

const DocxPreview = defineAsyncComponent(() => import('../../../components/preview/DocxPreview.vue'));
const docxPattern = /\.docx$/i;

export const docxPreviewProvider: FilePreviewProvider = {
  id: 'docx',
  priority: 85,
  maxInlineSize: 20 * 1024 * 1024,

  canPreview(file) {
    return (file.attrs.isFile || file.attrs.isSymbolicLink) && docxPattern.test(file.filename);
  },

  preview() {
    return DocxPreview;
  },

  async load(_file, context) {
    const response = await context.fetchInline();
    const buffer = await response.arrayBuffer();
    return {
      componentProps: { buffer },
    };
  },
};
