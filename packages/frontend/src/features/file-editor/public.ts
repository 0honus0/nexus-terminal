export const loadFileEditor = () => import('./components/FileEditor.vue');

export { createFileEditorSession } from './composables/useFileEditorSession';

export type { FileEditorSessionController } from './model/file-editor-session-types';

export type { FileDocumentPort } from './ports/file-document-port';

export { decodeEditorDocument } from './model/editorEncoding';
