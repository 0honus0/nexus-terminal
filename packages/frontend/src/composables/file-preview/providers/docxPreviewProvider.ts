import { defineAsyncComponent } from 'vue';
import type { FilePreviewProvider } from '../types';

const loadDocxPreviewComponent = () => import('../../../components/preview/DocxPreview.vue');
const DocxPreview = defineAsyncComponent(loadDocxPreviewComponent);
const docxPattern = /\.docx$/i;

export const docxPreviewProvider: FilePreviewProvider = {
  id: 'docx',
  priority: 85,
  maxInlineSize: 20 * 1024 * 1024,

  canPreview(file) {
    return (file.attrs.isFile || file.attrs.isSymbolicLink) && docxPattern.test(file.filename);
  },

  async preload() {
    await loadDocxPreviewComponent();
  },

  preview() {
    return DocxPreview;
  },

  async load(_file, context) {
    const [response] = await Promise.all([context.fetchInline(), loadDocxPreviewComponent()]);
    const buffer = await response.arrayBuffer();
    return {
      componentProps: { buffer },
    };
  },
};
