import type { BackupErrorCode } from '@nexus-terminal/shared/system/backups/values';

export interface BackupExportInput {
	password: string;
}

export interface BackupExportFile {
	content: Uint8Array;
}

export interface BackupImportInput {
	content: Uint8Array;
	password: string | null;
}

export interface BackupImportReceipt {
	restoredTables: number;
	restoredRows: number;
	restoredFiles: number;
	cleanupPending: boolean;
}

export interface BackupPreparedImport {
	apply(signal: AbortSignal): Promise<BackupImportReceipt>;
	close(): void;
}

export class BackupFailure extends Error {
	constructor(
		readonly code: BackupErrorCode,
		options?: ErrorOptions,
	) {
		super('Backup failed: ' + code, options);
		this.name = 'BackupFailure';
	}
}

/** Safe external code stays unavailable; only the owning service receives the resource consequence. */
export class BackupResourceFailure extends BackupFailure {
	constructor(options: ErrorOptions) {
		super('unavailable', options);
		this.name = 'BackupResourceFailure';
	}
}
