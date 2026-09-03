export interface BackupFileEntry {
  path: string;
  contentBase64: string;
}

export interface BackupSnapshot {
  format: 'nexus-terminal-backup';
  version: 1;
  createdAt: string;
  tables: Record<string, Record<string, unknown>[]>;
  files: BackupFileEntry[];
}

export interface BackupImportResult {
  restoredTables: number;
  restoredRows: number;
  restoredFiles: number;
  usedPassword: boolean;
}
