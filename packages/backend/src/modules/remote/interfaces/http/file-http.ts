import { readRequestCookie } from '../../../../platform/http/http-request.js';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { finished } from 'node:stream/promises';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import { TargetOperationError } from '../../../targets/public-errors.js';
import { RemoteHostKeyUntrustedError } from '../../machines/model/machine-errors.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import {
	RemoteFileFailure,
	type FileEntry,
	type FileInfo,
	type RemoteFileFailureCode,
} from '../../files/model/file-types.js';
import type { RemoteFileService } from '../../files/service/file-service.js';
import {
	REMOTE_FILE_MAX_LIST_ENTRIES,
	REMOTE_FILE_MAX_METADATA_BYTES,
	REMOTE_FILE_MAX_REQUEST_BYTES,
	REMOTE_FILE_MAX_RESPONSE_BYTES,
	REMOTE_FILE_MAX_TEXT_BYTES,
	REMOTE_FILE_MAX_WRITE_REQUEST_BYTES,
	type RemoteFileErrorCode,
} from '@nexus-terminal/shared/remote/files/values';
import type { RemoteFileInfo } from '@nexus-terminal/shared/remote/files/model';
import type {
	RemoteFileCloseResponse,
	RemoteFileCreateDirectoryResponse,
	RemoteFileErrorResponse,
	RemoteFileListResponse,
	RemoteFileOpenResponse,
	RemoteFileRemoveDirectoryResponse,
	RemoteFileRemoveResponse,
	RemoteFileRenameResponse,
	RemoteFileStatResponse,
	RemoteFileTextResponse,
	RemoteFileWriteTextResponse,
} from '@nexus-terminal/shared/remote/files/http';
import {
	InvalidRemoteFilePayload,
	readRemoteFileOpenRequest,
	readRemoteFilePathRequest,
	readRemoteFileRenameRequest,
	readRemoteFileWriteTextRequest,
} from '@nexus-terminal/shared/remote/files/http-codec';

const OPEN_DELIVERY_MS = 15_000;

const ROOT = '/api/v1/remote/files';

function toInfo(value: FileInfo): RemoteFileInfo {
	return {
		size: value.size,
		mode: value.mode,
		modifiedAt: value.modifiedAt,
		kind: value.kind,
	};
}

function toEntry(value: FileEntry): RemoteFileListResponse['entries'][number] {
	return { name: value.name, info: toInfo(value.info) };
}

function resourceId(request: HttpRequest): string {
	const value = request.params.id;
	if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
		throw new RemoteFileFailure('invalid_input');
	}
	return value;
}

function toWireError(code: RemoteFileFailureCode): RemoteFileErrorCode {
	switch (code) {
		case 'unauthenticated':
		case 'forbidden':
		case 'not_found':
		case 'invalid_input':
		case 'stale_target':
		case 'host_key_untrusted':
		case 'limit_exceeded':
		case 'not_text':
		case 'conflict':
		case 'operation_unknown':
		case 'remote_unavailable':
			return code;
	}
}

function errorCode(error: unknown): RemoteFileErrorCode {
	if (error instanceof RemoteResourceCleanupFailure) {
		return 'operation_unknown';
	}
	if (error instanceof RemoteFileFailure) {
		return toWireError(error.code);
	}
	if (error instanceof RemoteHostKeyUntrustedError) {
		return 'host_key_untrusted';
	}
	if (error instanceof TargetOperationError) {
		if (error.code === 'conflict') {
			return 'stale_target';
		}
		if (error.code === 'reference_not_found') {
			return 'not_found';
		}
	}
	return 'remote_unavailable';
}

function status(code: RemoteFileErrorCode): number {
	switch (code) {
		case 'invalid_json':
		case 'invalid_path':
		case 'invalid_input':
			return 400;
		case 'invalid_host':
		case 'csrf_rejected':
		case 'forbidden':
			return 403;
		case 'unauthenticated':
			return 401;
		case 'not_found':
			return 404;
		case 'body_too_large':
		case 'limit_exceeded':
			return 413;
		case 'unsupported_media_type':
		case 'not_text':
			return 415;
		case 'stale_target':
		case 'conflict':
			return 409;
		case 'host_key_untrusted':
			return 422;
		case 'internal_failure':
			return 500;
		case 'shutting_down':
		case 'operation_unknown':
			return 503;
		case 'remote_unavailable':
			return 503;
	}
}

function send(reply: HttpReply, code: number, body: unknown): void {
	reply.type('application/json; charset=utf-8').serializer((payload) => {
		let encoded: string;
		try {
			encoded = JSON.stringify(payload);
		} catch {
			throw new RemoteFileFailure('remote_unavailable');
		}
		if (Buffer.byteLength(encoded, 'utf8') > REMOTE_FILE_MAX_RESPONSE_BYTES) {
			throw new RemoteFileFailure('limit_exceeded');
		}
		return encoded;
	});
	reply.code(code).send(body);
}

function route(
	method: HttpRoute['method'],
	path: string,
	action: (request: HttpRequest, reply: HttpReply, signal: AbortSignal) => Promise<void>,
	bodyLimit = REMOTE_FILE_MAX_REQUEST_BYTES,
): HttpRoute {
	return {
		method,
		url: ROOT + path,

		errorHandler(error, _request, reply) {
			if (!(error instanceof RemoteFileFailure)) {
				throw error;
			}
			reply.removeHeader('Set-Cookie');
			reply.type('application/json; charset=utf-8').serializer(JSON.stringify);
			const code = errorCode(error);
			reply.code(status(code)).send({ code } satisfies RemoteFileErrorResponse);
		},

		bodyLimit,

		async handler(request: HttpRequest, reply: HttpReply) {
			const controller = new AbortController();

			const aborted = () => controller.abort();

			const disconnected = () => {
				if (!reply.raw.writableFinished) {
					controller.abort();
				}
			};

			request.raw.once('aborted', aborted);
			reply.raw.once('close', disconnected);
			if (request.raw.aborted || reply.raw.destroyed) {
				aborted();
			}
			try {
				if (request.query.size) {
					throw new RemoteFileFailure('invalid_input');
				}
				if (
					method === 'DELETE' &&
					(request.raw.headers['transfer-encoding'] !== undefined ||
						(request.raw.headers['content-length'] !== undefined &&
							request.raw.headers['content-length'] !== '0'))
				) {
					throw new RemoteFileFailure('invalid_input');
				}
				await action(request, reply, controller.signal);
			} catch (error) {
				if (error instanceof HttpInputFailure) {
					throw error;
				}
				if (reply.raw.destroyed || request.raw.aborted) {
					return;
				}
				if (reply.raw.headersSent) {
					reply.raw.destroy();
					return;
				}
				const code = error instanceof InvalidRemoteFilePayload ? 'invalid_input' : errorCode(error);
				send(reply, status(code), { code } satisfies RemoteFileErrorResponse);
			} finally {
				request.raw.off('aborted', aborted);
				reply.raw.off('close', disconnected);
			}
		},
	};
}

/** Files HTTP is independent of the PTY WebSocket lifecycle. */
export function createRemoteFileHttpRoutes(files: RemoteFileService): HttpRoute[] {
	return [
		route('POST', '/resources', async (request, reply, signal) => {
			const input = readRemoteFileOpenRequest(request.body);
			const opened = await files.open(
				readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
				input.targetId,
				signal,
			);
			const delivery = new AbortController();
			const timer = setTimeout(() => delivery.abort(), OPEN_DELIVERY_MS);
			timer.unref();
			const socket = reply.raw.socket;
			let delivered = false;

			const finishedDelivery = () => {
				delivered =
					reply.raw.statusCode === 201 &&
					!reply.raw.destroyed &&
					socket?.destroyed !== true &&
					!request.raw.aborted;
			};

			reply.raw.once('finish', finishedDelivery);
			try {
				signal.throwIfAborted();
				send(reply, 201, {
					id: opened.id,
					targetId: opened.targetId,
					configurationFingerprint: opened.fingerprint,
				} satisfies RemoteFileOpenResponse);
				await finished(reply.raw, { signal: AbortSignal.any([signal, delivery.signal]), cleanup: true });
				if (!delivered) {
					throw new RemoteFileFailure('remote_unavailable');
				}
			} catch (error) {
				try {
					await opened.release();
				} catch (cleanup) {
					throw new RemoteResourceCleanupFailure([error, cleanup]);
				}
				throw error;
			} finally {
				clearTimeout(timer);
				reply.raw.off('finish', finishedDelivery);
			}
		}),
		route('DELETE', '/resources/:id', async (request, reply, signal) => {
			await files.release(
				readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
				resourceId(request),
				signal,
			);
			send(reply, 200, { closed: true } satisfies RemoteFileCloseResponse);
		}),
		route('POST', '/resources/:id/list', async (request, reply, signal) => {
			const input = readRemoteFilePathRequest(request.body);
			const entries = await files.list(
				readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
				resourceId(request),
				input.path,
				REMOTE_FILE_MAX_LIST_ENTRIES,
				REMOTE_FILE_MAX_METADATA_BYTES,
				signal,
			);
			send(reply, 200, {
				complete: true,
				entries: entries.map(toEntry),
			} satisfies RemoteFileListResponse);
		}),
		route('POST', '/resources/:id/stat', async (request, reply, signal) => {
			const input = readRemoteFilePathRequest(request.body);
			const info = await files.stat(
				readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
				resourceId(request),
				input.path,
				true,
				signal,
			);
			send(reply, 200, { info: toInfo(info) } satisfies RemoteFileStatResponse);
		}),
		route('POST', '/resources/:id/lstat', async (request, reply, signal) => {
			const input = readRemoteFilePathRequest(request.body);
			const info = await files.stat(
				readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
				resourceId(request),
				input.path,
				false,
				signal,
			);
			send(reply, 200, { info: toInfo(info) } satisfies RemoteFileStatResponse);
		}),
		route('POST', '/resources/:id/read-text', async (request, reply, signal) => {
			const input = readRemoteFilePathRequest(request.body);
			const result = await files.readText(
				readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
				resourceId(request),
				input.path,
				REMOTE_FILE_MAX_TEXT_BYTES,
				signal,
			);
			send(reply, 200, {
				info: toInfo(result.info),
				bytes: result.bytes,
				sha256: result.sha256,
				text: result.text,
			} satisfies RemoteFileTextResponse);
		}),
		route(
			'POST',
			'/resources/:id/write-text',
			async (request, reply, signal) => {
				const input = readRemoteFileWriteTextRequest(request.body);
				const result = await files.writeText(
					readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
					resourceId(request),
					input.path,
					input.text,
					input.expectedSha256,
					REMOTE_FILE_MAX_TEXT_BYTES,
					signal,
				);
				send(reply, result.status === 'created' ? 201 : 200, {
					status: result.status,
					info: toInfo(result.info),
					bytes: result.bytes,
					sha256: result.sha256,
				} satisfies RemoteFileWriteTextResponse);
			},
			REMOTE_FILE_MAX_WRITE_REQUEST_BYTES,
		),
		route('POST', '/resources/:id/rename', async (request, reply, signal) => {
			const input = readRemoteFileRenameRequest(request.body);
			const result = await files.rename(
				readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
				resourceId(request),
				input.from,
				input.to,
				signal,
			);
			send(reply, 200, {
				from: result.from,
				to: result.to,
				kind: result.kind,
			} satisfies RemoteFileRenameResponse);
		}),
		route('POST', '/resources/:id/remove', async (request, reply, signal) => {
			const input = readRemoteFilePathRequest(request.body);
			const result = await files.remove(
				readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
				resourceId(request),
				input.path,
				signal,
			);
			send(reply, 200, {
				path: result.path,
				kind: result.kind,
				removed: true,
			} satisfies RemoteFileRemoveResponse);
		}),
		route('POST', '/resources/:id/mkdir', async (request, reply, signal) => {
			const input = readRemoteFilePathRequest(request.body);
			const result = await files.mkdir(
				readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
				resourceId(request),
				input.path,
				signal,
			);
			send(reply, 201, { path: result.path, created: true } satisfies RemoteFileCreateDirectoryResponse);
		}),
		route('POST', '/resources/:id/rmdir', async (request, reply, signal) => {
			const input = readRemoteFilePathRequest(request.body);
			const result = await files.rmdir(
				readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
				resourceId(request),
				input.path,
				signal,
			);
			send(reply, 200, { path: result.path, removed: true } satisfies RemoteFileRemoveDirectoryResponse);
		}),
	];
}
