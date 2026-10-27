import { record, InvalidPayload } from '../../common/http-codec.js';
import { ACCESS_PASSWORD_MAX_BYTES } from '../../access/values.js';
import type { BackupExportRequest, BackupErrorResponse, BackupImportRequest, BackupImportResponse } from './http.js';
import { BACKUP_REQUEST_MAX_BYTES, BACKUP_ERROR_CODES, BACKUP_MAX_FILE_BYTES } from './values.js';

export function readBackupExport(input: unknown): BackupExportRequest {
	const value = record(input, ['password'], BACKUP_REQUEST_MAX_BYTES);
	const password = value.password;
	if (
		typeof password !== 'string' ||
		!password.length ||
		new TextEncoder().encode(password).byteLength > ACCESS_PASSWORD_MAX_BYTES ||
		new TextDecoder().decode(new TextEncoder().encode(password)) !== password
	) {
		throw new InvalidPayload();
	}
	return { password };
}

export function readBackupError(input: unknown): BackupErrorResponse {
	const value = record(input, ['code'], 1024);
	const code = BACKUP_ERROR_CODES.find((code) => code === value.code);
	if (!code) {
		throw new InvalidPayload();
	}
	return { code };
}

export function readBackupImport(input: unknown): BackupImportRequest {
	if (
		input === null ||
		typeof input !== 'object' ||
		Object.keys(input).length !== 2 ||
		!('backupFile' in input) ||
		!(input.backupFile instanceof Uint8Array) ||
		!('password' in input)
	) {
		throw new InvalidPayload();
	}
	const password = input.password;
	if (
		input.backupFile.byteLength < 1 ||
		input.backupFile.byteLength > BACKUP_MAX_FILE_BYTES ||
		(password !== null &&
			(typeof password !== 'string' ||
				!password.length ||
				new TextEncoder().encode(password).byteLength > ACCESS_PASSWORD_MAX_BYTES ||
				new TextDecoder().decode(new TextEncoder().encode(password)) !== password))
	) {
		throw new InvalidPayload();
	}
	return { backupFile: input.backupFile, password };
}

export function readBackupImportResponse(input: unknown): BackupImportResponse {
	const value = record(input, ['restoredTables', 'restoredRows', 'restoredFiles', 'cleanupPending'], 1024);
	const { restoredTables, restoredRows, restoredFiles, cleanupPending } = value;
	if (
		typeof restoredTables !== 'number' ||
		!Number.isSafeInteger(restoredTables) ||
		restoredTables < 1 ||
		typeof restoredRows !== 'number' ||
		!Number.isSafeInteger(restoredRows) ||
		restoredRows < 0 ||
		typeof restoredFiles !== 'number' ||
		!Number.isSafeInteger(restoredFiles) ||
		restoredFiles < 0 ||
		typeof cleanupPending !== 'boolean'
	) {
		throw new InvalidPayload();
	}
	return { restoredTables, restoredRows, restoredFiles, cleanupPending };
}
