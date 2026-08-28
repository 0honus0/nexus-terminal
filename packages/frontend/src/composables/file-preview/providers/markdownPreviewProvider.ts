import MarkdownPreview from '../../../components/preview/MarkdownPreview.vue';
import type { FilePreviewProvider } from '../types';

const markdownPattern = /\.(md|markdown)$/i;
const loadMarkdownRuntime = () => Promise.all([import('dompurify'), import('marked')]);

export const markdownPreviewProvider: FilePreviewProvider = {
  id: 'markdown',
  priority: 90,
  maxInlineSize: 2 * 1024 * 1024,

  canPreview(file) {
    return file.attrs.isFile && markdownPattern.test(file.filename);
  },

  async preload() {
    await loadMarkdownRuntime();
  },

  preview() {
    return MarkdownPreview;
  },

  async load(_file, context) {
    const [[{ default: DOMPurify }, { marked }], response] = await Promise.all([
      loadMarkdownRuntime(),
      context.fetchInline(),
    ]);
    const source = await response.text();
    const rendered = await marked.parse(source, {
      gfm: true,
      breaks: false,
    });

    const html = DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: [
        'audio',
        'button',
        'embed',
        'form',
        'iframe',
        'img',
        'input',
        'object',
        'option',
        'select',
        'source',
        'style',
        'textarea',
        'video',
      ],
      FORBID_ATTR: ['srcset', 'style'],
    });

    return {
      componentProps: { html },
    };
  },
};
