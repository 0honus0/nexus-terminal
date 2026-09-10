export type EditorSaveState = 'idle' | 'saving' | 'saved' | 'error';
export type EditorLineEnding = 'lf' | 'crlf' | 'cr';
export interface EditorDocument {
  id: string;
  scopeId?: string;
  scopeLabel?: string;
  path: string;
  name: string;
  content: string;
  originalContent: string;
  rawContent: Uint8Array;
  encoding: string;
  language: string;
  dirty: boolean;
  saveState: EditorSaveState;
  scrollTop: number;
  scrollLeft: number;
  error?: string;
}
export interface LoadedEditorDocument {
  path: string;
  content: string;
  rawContent: Uint8Array;
  encoding: string;
}
