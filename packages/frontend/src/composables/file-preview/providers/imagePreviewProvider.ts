import ImagePreview from '../../../components/preview/ImagePreview.vue';
import type { FilePreviewProvider } from '../types';

// SVG is intentionally excluded: remote SVG files may reference external resources.
const imagePattern = /\.(png|jpe?g|gif|webp)$/i;

export const imagePreviewProvider: FilePreviewProvider = {
  id: 'image',
  priority: 100,
  maxInlineSize: 20 * 1024 * 1024,

  canPreview(file) {
    return file.attrs.isFile && imagePattern.test(file.filename);
  },

  preview() {
    return ImagePreview;
  },

  load(_file, context) {
    return {
      componentProps: {
        src: context.buildInlineUrl(context.filePath),
      },
    };
  },
};
