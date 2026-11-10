export const loadFilePreview = () => import('./components/FilePreview.vue');

export { previewKindFor } from './providers/previewRegistry';

export { createFilePreviewSession } from './composables/useFilePreviewTabs';

export type { FilePreviewSessionController } from './composables/useFilePreviewTabs';

export type { FilePreviewSource } from './ports/file-preview-source';
