export interface FilePreviewReadOptions {
  maxBytes?: number;
  signal?: AbortSignal;
}

export type FilePreviewReadResult =
  { bytes: ArrayBuffer; mimeType?: string } | { tooLarge: true; actualBytes: number; maxBytes: number };

export interface FilePreviewSource {
  read(path: string, options?: FilePreviewReadOptions): Promise<FilePreviewReadResult>;
}
