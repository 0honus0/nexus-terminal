import { defineAsyncComponent } from 'vue';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { FilePreviewProvider } from '../types';

const PdfPreview = defineAsyncComponent(() => import('../../../components/preview/PdfPreview.vue'));
const pdfPattern = /\.pdf$/i;

export const pdfPreviewProvider: FilePreviewProvider = {
  id: 'pdf',
  priority: 90,
  maxInlineSize: 25 * 1024 * 1024,

  canPreview(file) {
    return file.attrs.isFile && pdfPattern.test(file.filename);
  },

  preview() {
    return PdfPreview;
  },

  async load(_file, context) {
    const [{ GlobalWorkerOptions, getDocument }, response] = await Promise.all([
      import('pdfjs-dist'),
      context.fetchInline(),
    ]);

    GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const data = new Uint8Array(await response.arrayBuffer());
    if (context.signal.aborted) throw new DOMException('Preview aborted', 'AbortError');

    const loadingTask = getDocument({ data });
    const abortLoading = () => {
      void loadingTask.destroy();
    };
    context.signal.addEventListener('abort', abortLoading, { once: true });

    try {
      const document = await loadingTask.promise;
      context.signal.removeEventListener('abort', abortLoading);

      if (context.signal.aborted) {
        await loadingTask.destroy();
        throw new DOMException('Preview aborted', 'AbortError');
      }

      const outline = (await document.getOutline()) ?? [];
      return {
        componentProps: {
          document,
          outline,
        },
        dispose: () => {
          void loadingTask.destroy();
        },
      };
    } catch (error) {
      context.signal.removeEventListener('abort', abortLoading);
      throw error;
    }
  },
};
