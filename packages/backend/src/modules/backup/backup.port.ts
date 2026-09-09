import type { BackupSnapshot } from './backup.types';

export interface BackupSnapshotPort {
  capture(): Promise<BackupSnapshot>;
  restore(snapshot: BackupSnapshot): Promise<{ restoredTables: number; restoredRows: number; restoredFiles: number }>;
}

export interface BackupCodecPort {
  encode(snapshot: BackupSnapshot, password: string): Promise<Uint8Array>;
  decode(bytes: Uint8Array, password?: string): Promise<{ snapshot: BackupSnapshot; usedPassword: boolean }>;
}

export interface BackupRestoreHooks {
  beforeRestore?(): Promise<void>;
  afterRestore?(): Promise<void>;
}
