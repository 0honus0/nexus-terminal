import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { readBackupExport, readBackupImport } from '@nexus-terminal/shared/system/backups/http-codec';
import {
	BACKUP_REQUEST_MAX_BYTES,
	BACKUP_MAX_FILE_BYTES,
	BACKUP_MULTIPART_MAX_BYTES,
} from '@nexus-terminal/shared/system/backups/values';
import { ACCESS_PASSWORD_MAX_BYTES } from '@nexus-terminal/shared/access/values';
import type { BackupImportResponse } from '@nexus-terminal/shared/system/backups/http';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { InvalidPayload } from '@nexus-terminal/shared/common/http-codec';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { BackupService } from '../../backups/service/backup-service.js';
import {
	BackupFailure,
	type BackupExportFile,
	type BackupExportInput,
	type BackupImportInput,
} from '../../backups/model/backup-types.js';
import { readMultipart } from '../../../../platform/http/http-body.js';
import type { IncomingMessage } from 'node:http';

/** Transport status remains owned by HTTP; cause is retained only for diagnosis. */
class BackupInputFailure extends BackupFailure {
	readonly status: number;

	constructor(cause: HttpInputFailure) {
		super(cause.status === 413 ? 'limit_exceeded' : 'invalid_input', { cause });
		this.status = cause.status;
	}
}

async function readImport(request: HttpRequest, reply: HttpReply, signal: AbortSignal): Promise<BackupImportInput> {
	const owned: Uint8Array[] = [];
	let file: Uint8Array | null = null;
	try {
		if (request.query.size) {
			throw new InvalidPayload();
		}
		const parts = await readMultipart(
			request,
			reply,
			{
				maxParts: 2,
				maxFileBytes: BACKUP_MAX_FILE_BYTES,
				maxFieldBytes: ACCESS_PASSWORD_MAX_BYTES,
			},
			signal,
		);
		for (const part of parts) {
			owned.push(part.bytes);
		}
		let password: string | null = null;
		let hasPassword = false;
		for (const part of parts) {
			if (part.name === 'backupFile' && part.bytes.byteLength > BACKUP_MAX_FILE_BYTES) {
				throw new BackupFailure('limit_exceeded');
			}
			if (
				part.name === 'backupFile' &&
				part.filename !== null &&
				file === null &&
				part.bytes.byteLength > 0 &&
				part.bytes.byteLength <= BACKUP_MAX_FILE_BYTES
			) {
				file = part.bytes;
			} else if (
				part.name === 'password' &&
				part.filename === null &&
				!hasPassword &&
				part.bytes.byteLength <= ACCESS_PASSWORD_MAX_BYTES
			) {
				hasPassword = true;
				const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(part.bytes);
				password = value.length ? value : null;
			} else {
				throw new InvalidPayload();
			}
		}
		if (!file) {
			throw new InvalidPayload();
		}
		const decoded = readBackupImport({ backupFile: file, password });
		const content = decoded.backupFile;
		file = null;
		for (let index = owned.length - 1; index >= 0; index--) {
			if (owned[index] === content) {
				owned.splice(index, 1);
			}
		}
		return { content, password: decoded.password };
	} catch (cause) {
		if (cause instanceof HttpInputFailure) {
			throw new BackupInputFailure(cause);
		}
		if (cause instanceof InvalidPayload || cause instanceof TypeError) {
			throw new BackupFailure('invalid_input', { cause });
		}
		throw cause;
	} finally {
		for (const bytes of owned) {
			bytes.fill(0);
		}
	}
}

async function readExport(request: HttpRequest, signal: AbortSignal): Promise<BackupExportInput> {
	try {
		if (request.query.size) {
			throw new InvalidPayload();
		}
		signal.throwIfAborted();
		const decoded = readBackupExport(request.body);
		return { password: decoded.password };
	} catch (cause) {
		if (cause instanceof HttpInputFailure) {
			throw new BackupInputFailure(cause);
		}
		if (cause instanceof InvalidPayload) {
			throw new BackupFailure('invalid_input', { cause });
		}
		throw cause;
	}
}

function deliverExport(reply: HttpReply, file: BackupExportFile, signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			reply.raw.off('finish', finish);
			reply.raw.off('close', fail);
			reply.raw.off('error', fail);
			signal.removeEventListener('abort', abort);
		};

		const finish = () => {
			cleanup();
			if (reply.raw.destroyed || !reply.raw.writableFinished) {
				reject(new BackupFailure('unavailable'));
				return;
			}
			resolve();
		};

		const fail = () => {
			cleanup();
			reject(new BackupFailure('unavailable'));
		};

		const abort = () => {
			reply.raw.destroy();
			fail();
		};

		reply.raw.once('finish', finish);
		reply.raw.once('close', fail);
		reply.raw.once('error', fail);
		signal.addEventListener('abort', abort, { once: true });
		try {
			reply.hijack();
			reply.raw.writeHead(200, {
				'Content-Type': 'application/octet-stream',
				'Content-Length': String(file.content.byteLength),
				'Content-Disposition': 'attachment; filename="nexus-terminal.nexus-backup"',
				'Cache-Control': 'no-store',
			});
			reply.raw.end(file.content);
		} catch (cause) {
			cleanup();
			reject(cause);
		}
	});
}

function errorStatus(code: BackupFailure['code']): number {
	if (code === 'invalid_input') {
		return 400;
	}
	if (code === 'unauthenticated' || code === 'invalid_password') {
		return 401;
	}
	if (code === 'forbidden') {
		return 403;
	}
	if (code === 'busy' || code === 'source_changed') {
		return 409;
	}
	return code === 'limit_exceeded' ? 413 : 503;
}

function sendFailure(reply: HttpReply, failure: unknown): void {
	if (!reply.sent && !reply.raw.headersSent && !reply.raw.destroyed) {
		const code = failure instanceof BackupFailure ? failure.code : 'unavailable';
		const status = failure instanceof BackupInputFailure ? failure.status : errorStatus(code);
		reply.code(status).send({ code });
	} else if (!reply.raw.writableFinished) {
		reply.raw.destroy();
	}
}

export function createBackupRoutes(
	service: BackupService,
	maintain: (request: IncomingMessage, apply: () => Promise<boolean>) => Promise<void>,
): HttpRoute[] {
	return [
		{
			method: 'POST',
			url: '/api/v1/settings/backup/export',
			bodyLimit: BACKUP_REQUEST_MAX_BYTES,

			async handler(request, reply) {
				const disconnected = new AbortController();

				const abort = () => {
					if (!reply.raw.writableFinished) {
						disconnected.abort();
					}
				};

				reply.raw.once('close', abort);
				try {
					await service.export(
						readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
						(signal) => readExport(request, signal),
						(file, signal) => deliverExport(reply, file, signal),
						disconnected.signal,
					);
				} catch (error) {
					sendFailure(reply, error);
				} finally {
					reply.raw.off('close', abort);
				}
			},
		},
		{
			method: 'POST',
			url: '/api/v1/settings/backup/import',
			bodyLimit: BACKUP_MULTIPART_MAX_BYTES,
			config: { multipartBodyLimit: BACKUP_MULTIPART_MAX_BYTES },

			async handler(request, reply) {
				const disconnected = new AbortController();

				const abort = () => {
					if (!reply.raw.writableFinished) {
						disconnected.abort();
					}
				};

				reply.raw.once('close', abort);
				try {
					const receipt = await service.import(
						readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
						(signal) => readImport(request, reply, signal),
						(apply) => maintain(request.raw, apply),
						disconnected.signal,
					);
					const response: BackupImportResponse = {
						restoredTables: receipt.restoredTables,
						restoredRows: receipt.restoredRows,
						restoredFiles: receipt.restoredFiles,
						cleanupPending: receipt.cleanupPending,
					};
					if (!reply.raw.destroyed) {
						reply.code(200).send(response);
					}
				} catch (cause) {
					sendFailure(reply, cause);
				} finally {
					reply.raw.off('close', abort);
				}
			},
		},
	];
}
