import {
	readBackupExport,
	readBackupImport,
	readBackupError,
	readBackupImportResponse,
} from '@nexus-terminal/shared/system/backups/http-codec';
import {
	BACKUP_MAX_FILE_BYTES,
	BACKUP_MULTIPART_MAX_BYTES,
	BACKUP_REQUEST_MAX_BYTES,
	type BackupErrorCode,
} from '@nexus-terminal/shared/system/backups/values';
import { requestBinary } from '@/client/http/binary-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { BackupRequestFailure, type RestoreReceipt } from '../model/backup-types';
import { fromRestoreReceipt } from '../model/backup-mapper';

function json(bytes: Uint8Array, contentType: string | null): unknown {
	if (!contentType || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType.trim())) {
		throw new BackupRequestFailure('protocol_failure', 'unknown');
	}
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch (cause) {
		throw new BackupRequestFailure('protocol_failure', 'unknown', { cause });
	}
}

function status(code: BackupErrorCode): number {
	if (code === 'invalid_input') {
		return 400;
	}
	if (code === 'invalid_password' || code === 'unauthenticated') {
		return 401;
	}
	if (code === 'forbidden') {
		return 403;
	}
	if (code === 'source_changed' || code === 'busy') {
		return 409;
	}
	return code === 'limit_exceeded' ? 413 : 503;
}

async function request(input: {
	body: string | FormData;
	operation: 'export' | 'import';
	signal?: AbortSignal;
}): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string | null }> {
	try {
		const response = await requestBinary({
			method: 'POST',
			url: '/api/v1/settings/backup/' + input.operation,
			body: input.body,
			headers:
				typeof input.body === 'string'
					? { 'Content-Type': 'application/json', Accept: 'application/octet-stream, application/json' }
					: { Accept: 'application/json' },
			maxRequestBytes: input.operation === 'import' ? BACKUP_MULTIPART_MAX_BYTES : BACKUP_REQUEST_MAX_BYTES,
			maxResponseBytes: input.operation === 'export' ? BACKUP_MAX_FILE_BYTES : BACKUP_REQUEST_MAX_BYTES,
			maxErrorBytes: BACKUP_REQUEST_MAX_BYTES,
			timeoutMs: 120000,
			signal: input.signal,
		});
		const contentType = response.headers.get('content-type');
		if (response.status >= 400) {
			let code: BackupErrorCode;
			try {
				code = readBackupError(json(response.bytes, contentType)).code;
				if (response.status !== status(code)) {
					throw new Error('Inconsistent backup status');
				}
			} catch (cause) {
				throw new BackupRequestFailure('protocol_failure', 'unknown', { cause });
			}
			const unknown = [
				'operation_unknown',
				'storage_unavailable',
				'internal_failure',
				'unavailable',
				'shutting_down',
			].includes(code);
			throw new BackupRequestFailure(code, unknown ? 'unknown' : 'confirmed');
		}
		if (response.status !== 200) {
			throw new BackupRequestFailure('protocol_failure', 'unknown');
		}
		return { bytes: response.bytes, contentType };
	} catch (cause) {
		if (cause instanceof BackupRequestFailure) {
			throw cause;
		}
		if (cause instanceof HttpRequestFailure) {
			throw new BackupRequestFailure(cause.code, cause.outcome, { cause });
		}
		throw new BackupRequestFailure('request_failed', 'unknown', { cause });
	}
}

async function deliver(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
	const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
	const anchor = document.createElement('a');
	try {
		anchor.href = url;
		anchor.download = 'nexus-terminal.nexus-backup';
		anchor.rel = 'noopener';
		document.body.append(anchor);
		anchor.click();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	} finally {
		anchor.remove();
		URL.revokeObjectURL(url);
	}
}

export const backupApi = {
	async exportFull(password: string, signal?: AbortSignal): Promise<void> {
		let input;
		try {
			input = readBackupExport({ password });
		} catch (cause) {
			throw new BackupRequestFailure('invalid_input', 'not_dispatched', { cause });
		}
		const result = await request({ body: JSON.stringify(input), operation: 'export', signal });
		if (result.contentType?.trim().toLowerCase() !== 'application/octet-stream' || result.bytes.byteLength === 0) {
			throw new BackupRequestFailure('protocol_failure', 'unknown');
		}
		if (signal?.aborted) {
			throw new BackupRequestFailure('cancelled', 'confirmed');
		}
		await deliver(result.bytes);
	},

	async importFull(file: File, password: string | null, signal?: AbortSignal): Promise<RestoreReceipt> {
		const deadline = AbortSignal.timeout(120000);
		const scope = signal ? AbortSignal.any([signal, deadline]) : deadline;
		let form: FormData;
		try {
			if (scope.aborted) {
				throw new BackupRequestFailure('cancelled', 'not_dispatched');
			}
			if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > BACKUP_MAX_FILE_BYTES) {
				throw new BackupRequestFailure('invalid_input', 'not_dispatched');
			}
			const bytes = new Uint8Array(await file.arrayBuffer());
			const input = readBackupImport({ backupFile: bytes, password });
			if (scope.aborted) {
				throw new BackupRequestFailure('cancelled', 'not_dispatched');
			}
			form = new FormData();
			form.append('backupFile', new Blob([input.backupFile.slice()]), 'nexus-terminal.nexus-backup');
			if (input.password !== null) {
				form.append('password', input.password);
			}
		} catch (cause) {
			if (cause instanceof BackupRequestFailure) {
				throw cause;
			}
			throw new BackupRequestFailure('invalid_input', 'not_dispatched', { cause });
		}
		const result = await request({ body: form, operation: 'import', signal: scope });
		try {
			const value = readBackupImportResponse(json(result.bytes, result.contentType));
			return fromRestoreReceipt(value);
		} catch (cause) {
			if (cause instanceof BackupRequestFailure) {
				throw cause;
			}
			throw new BackupRequestFailure('protocol_failure', 'unknown', { cause });
		}
	},
};
