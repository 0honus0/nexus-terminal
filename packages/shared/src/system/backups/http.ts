import type { BackupErrorCode } from './values.js';

export interface BackupExportRequest {
	password: string;
}

export interface BackupErrorResponse {
	code: BackupErrorCode;
}

/** Multipart field contract; the transport encodes the binary file without JSON/base64. */
export interface BackupImportRequest {
	backupFile: Uint8Array;
	password: string | null;
}

export interface BackupImportResponse {
	restoredTables: number;
	restoredRows: number;
	restoredFiles: number;
	cleanupPending: boolean;
}
