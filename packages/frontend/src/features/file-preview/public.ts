export { default as FilePreview } from './components/FilePreview.vue';
export { previewInlineLimit, previewKindFor } from './providers/previewRegistry';
export { createFilePreviewSession, useFilePreviewTabs } from './composables/useFilePreviewTabs';
export type { FilePreviewSessionController, FilePreviewOpenContext } from './composables/useFilePreviewTabs';
export type { FilePreviewReadOptions, FilePreviewReadResult, FilePreviewSource } from './ports/file-preview-source';
export type { PreviewError, PreviewFile, PreviewKind, PreviewTab } from './model/preview';
