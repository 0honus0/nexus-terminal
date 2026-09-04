export type PreviewKind = 'image' | 'markdown' | 'pdf' | 'spreadsheet' | 'docx' | 'unsupported';

export interface PreviewFile {
  path: string;
  name: string;
  kind: PreviewKind;
  mimeType?: string;
  bytes: ArrayBuffer;
}

export type PreviewError =
  { type: 'message'; message: string } | { type: 'tooLarge'; maxBytes: number; actualBytes: number };

export interface PreviewTab {
  id: string;
  scopeId?: string;
  path: string;
  name: string;
  kind: PreviewKind;
  loading: boolean;
  refreshing: boolean;
  error?: PreviewError;
  file?: PreviewFile;
}
