export interface FileAttributes {
  size: number;
  uid: number;
  gid: number;
  mode: number;
  atime: number;
  mtime: number;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
}

export interface FileEntry {
  filename: string;
  longname: string;
  attrs: FileAttributes;
}

export interface FileSearchEntry extends FileEntry {
  basename: string;
  relativePath: string;
  path: string;
}

export interface FileSearchResult {
  items: FileSearchEntry[];
  truncated: boolean;
}

export interface ReadFileResult {
  rawContentBase64: string;
  encodingUsed: string;
}

export interface RealPathResult {
  requestedPath: string;
  absolutePath: string;
  targetType: 'file' | 'directory' | 'unknown';
}
