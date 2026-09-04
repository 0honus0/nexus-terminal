export { default as FileEditor } from './components/FileEditor.vue';
export { createFileEditorSession, useFileEditorSession } from './composables/useFileEditorSession';
export type { FileEditorSessionController, FileEditorOpenContext } from './composables/useFileEditorSession';
export type { FileDocumentPort } from './ports/file-document-port';
export type { EditorDocument, EditorLineEnding, EditorSaveState, LoadedEditorDocument } from './model/editor';
