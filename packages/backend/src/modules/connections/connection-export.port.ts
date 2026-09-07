export interface ConnectionExportFile {
  path: string;
  text: string;
}
export interface ConnectionExportArchivePort {
  encode(files: readonly ConnectionExportFile[]): Promise<Uint8Array>;
}
