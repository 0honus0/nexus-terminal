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
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { BackupService } from '../../backups/service/backup-service.js';
import {
	BackupFailure,
	type BackupExportFile,
	type BackupExportInput,
	type BackupImportInput,
} from '../../backups/model/backup-types.js';
import { readBodyBytes, decodeMultipart } from '../../../../platform/http/http-body.js';
import type { IncomingMessage } from 'node:http';

async function readImport(ctx: HttpRouteContext, signal: AbortSignal): Promise<BackupImportInput> {
	let body: Uint8Array | null = null;
	const owned: Uint8Array[] = [];
	let file: Uint8Array | null = null;
	try {
		if (ctx.query.size) {
			throw new InvalidPayload();
		}
		const bytes = await readBodyBytes(ctx.request, BACKUP_MULTIPART_MAX_BYTES, signal);
		body = bytes;
		const parts = decodeMultipart(bytes, ctx.request.headers['content-type'] ?? '', 2);
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
		const request = readBackupImport({ backupFile: file, password });
		const content = request.backupFile;
		file = null;
		for (let index = owned.length - 1; index >= 0; index--) {
			if (owned[index] === content) {
				owned.splice(index, 1);
			}
		}
		return { content, password: request.password };
	} catch (cause) {
		if (cause instanceof HttpInputFailure) {
			throw new BackupFailure(cause.status === 413 ? 'limit_exceeded' : 'invalid_input', { cause });
		}
		if (cause instanceof InvalidPayload || cause instanceof TypeError) {
			throw new BackupFailure('invalid_input', { cause });
		}
		throw cause;
	} finally {
		body?.fill(0);
		for (const bytes of owned) {
			bytes.fill(0);
		}
	}
}

async function readExport(ctx: HttpRouteContext, signal: AbortSignal): Promise<BackupExportInput> {
	try {
		if (ctx.query.size) {
			throw new InvalidPayload();
		}
		const request = readBackupExport(await ctx.json(signal));
		return { password: request.password };
	} catch (cause) {
		if (cause instanceof HttpInputFailure) {
			throw new BackupFailure(cause.status === 413 ? 'limit_exceeded' : 'invalid_input', { cause });
		}
		if (cause instanceof InvalidPayload) {
			throw new BackupFailure('invalid_input', { cause });
		}
		throw cause;
	}
}

function deliverExport(ctx: HttpRouteContext, file: BackupExportFile, signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			ctx.response.off('finish', finish);
			ctx.response.off('close', fail);
			ctx.response.off('error', fail);
			signal.removeEventListener('abort', abort);
		};

		const finish = () => {
			cleanup();
			resolve();
		};

		const fail = () => {
			cleanup();
			reject(new BackupFailure('unavailable'));
		};

		const abort = () => {
			ctx.response.destroy();
			fail();
		};

		ctx.response.once('finish', finish);
		ctx.response.once('close', fail);
		ctx.response.once('error', fail);
		signal.addEventListener('abort', abort, { once: true });
		try {
			ctx.response.writeHead(200, {
				'Content-Type': 'application/octet-stream',
				'Content-Length': String(file.content.byteLength),
				'Content-Disposition': 'attachment; filename="nexus-terminal.nexus-backup"',
				'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff',
			});
			ctx.response.end(file.content);
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

export function createBackupRoutes(
	service: BackupService,
	maintain: (request: IncomingMessage, apply: () => Promise<boolean>) => Promise<void>,
): HttpRoute[] {
	return [
		{
			method: 'POST',
			path: '/api/v1/settings/backup/export',
			maxBodyBytes: BACKUP_REQUEST_MAX_BYTES,

			async handle(ctx) {
				const disconnected = new AbortController();

				const abort = () => {
					if (!ctx.response.writableFinished) {
						disconnected.abort();
					}
				};

				ctx.response.once('close', abort);
				try {
					await service.export(
						ctx.cookie(ACCESS_SESSION_COOKIE_NAME),
						(signal) => readExport(ctx, signal),
						(file, signal) => deliverExport(ctx, file, signal),
						disconnected.signal,
					);
				} catch (error) {
					if (!ctx.response.headersSent && !ctx.response.destroyed) {
						const code = error instanceof BackupFailure ? error.code : 'unavailable';
						const status =
							error instanceof BackupFailure && error.cause instanceof HttpInputFailure
								? error.cause.status
								: errorStatus(code);
						ctx.send(status, { code });
					} else if (!ctx.response.writableFinished) {
						ctx.response.destroy();
					}
				} finally {
					ctx.response.off('close', abort);
				}
			},
		},
		{
			method: 'POST',
			path: '/api/v1/settings/backup/import',
			maxBodyBytes: BACKUP_MULTIPART_MAX_BYTES,

			async handle(ctx) {
				const disconnected = new AbortController();

				const abort = () => {
					if (!ctx.response.writableFinished) {
						disconnected.abort();
					}
				};

				ctx.response.once('close', abort);
				try {
					const receipt = await service.import(
						ctx.cookie(ACCESS_SESSION_COOKIE_NAME),
						(signal) => readImport(ctx, signal),
						(apply) => maintain(ctx.request, apply),
						disconnected.signal,
					);
					const response: BackupImportResponse = {
						restoredTables: receipt.restoredTables,
						restoredRows: receipt.restoredRows,
						restoredFiles: receipt.restoredFiles,
						cleanupPending: receipt.cleanupPending,
					};
					if (!ctx.response.destroyed) {
						ctx.send(200, response);
					}
				} catch (cause) {
					if (!ctx.response.headersSent && !ctx.response.destroyed) {
						const code = cause instanceof BackupFailure ? cause.code : 'unavailable';
						const status =
							cause instanceof BackupFailure && cause.cause instanceof HttpInputFailure
								? cause.cause.status
								: errorStatus(code);
						ctx.send(status, { code });
					} else if (!ctx.response.writableFinished) {
						ctx.response.destroy();
					}
				} finally {
					ctx.response.off('close', abort);
				}
			},
		},
	];
}
