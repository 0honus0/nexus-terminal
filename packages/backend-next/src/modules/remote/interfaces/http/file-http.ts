import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
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

function resourceId(ctx: HttpRouteContext): string {
	const value = ctx.params.id;
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

function send(ctx: HttpRouteContext, code: number, body: unknown): void {
	if (Buffer.byteLength(JSON.stringify(body), 'utf8') > REMOTE_FILE_MAX_RESPONSE_BYTES) {
		throw new RemoteFileFailure('limit_exceeded');
	}
	ctx.send(code, body);
}

function route(
	method: HttpRoute['method'],
	path: string,
	action: (ctx: HttpRouteContext, signal: AbortSignal) => Promise<void>,
	maxBodyBytes = REMOTE_FILE_MAX_REQUEST_BYTES,
): HttpRoute {
	return {
		method,
		path: ROOT + path,
		maxBodyBytes,

		async handle(ctx) {
			const controller = new AbortController();

			const aborted = () => controller.abort();

			const disconnected = () => {
				if (!ctx.response.writableEnded) {
					controller.abort();
				}
			};

			ctx.request.once('aborted', aborted);
			ctx.response.once('close', disconnected);
			try {
				if (ctx.query.size) {
					throw new RemoteFileFailure('invalid_input');
				}
				if (
					method === 'DELETE' &&
					(ctx.request.headers['transfer-encoding'] !== undefined ||
						(ctx.request.headers['content-length'] !== undefined &&
							ctx.request.headers['content-length'] !== '0'))
				) {
					throw new RemoteFileFailure('invalid_input');
				}
				await action(ctx, controller.signal);
			} catch (error) {
				if (error instanceof HttpInputFailure) {
					throw error;
				}
				const code = error instanceof InvalidRemoteFilePayload ? 'invalid_input' : errorCode(error);
				send(ctx, status(code), { code } satisfies RemoteFileErrorResponse);
			} finally {
				ctx.request.off('aborted', aborted);
				ctx.response.off('close', disconnected);
			}
		},
	};
}

/** Files HTTP is independent of the PTY WebSocket lifecycle. */
export function createRemoteFileHttpRoutes(files: RemoteFileService): HttpRoute[] {
	return [
		route('POST', '/resources', async (ctx, signal) => {
			const input = readRemoteFileOpenRequest(await ctx.json());
			const opened = await files.open(ctx.cookie('nexus_session'), input.targetId, signal);
			if (signal.aborted) {
				// Releasing after a disconnected opener must not inherit its cancellation.
				await files.release(ctx.cookie('nexus_session'), opened.id);
				return;
			}
			send(ctx, 201, {
				id: opened.id,
				targetId: opened.targetId,
				configurationFingerprint: opened.fingerprint,
			} satisfies RemoteFileOpenResponse);
		}),
		route('DELETE', '/resources/:id', async (ctx, signal) => {
			await files.release(ctx.cookie('nexus_session'), resourceId(ctx), signal);
			send(ctx, 200, { closed: true } satisfies RemoteFileCloseResponse);
		}),
		route('POST', '/resources/:id/list', async (ctx, signal) => {
			const input = readRemoteFilePathRequest(await ctx.json());
			const entries = await files.list(
				ctx.cookie('nexus_session'),
				resourceId(ctx),
				input.path,
				REMOTE_FILE_MAX_LIST_ENTRIES,
				REMOTE_FILE_MAX_METADATA_BYTES,
				signal,
			);
			send(ctx, 200, {
				complete: true,
				entries: entries.map(toEntry),
			} satisfies RemoteFileListResponse);
		}),
		route('POST', '/resources/:id/stat', async (ctx, signal) => {
			const input = readRemoteFilePathRequest(await ctx.json());
			const info = await files.stat(ctx.cookie('nexus_session'), resourceId(ctx), input.path, true, signal);
			send(ctx, 200, { info: toInfo(info) } satisfies RemoteFileStatResponse);
		}),
		route('POST', '/resources/:id/lstat', async (ctx, signal) => {
			const input = readRemoteFilePathRequest(await ctx.json());
			const info = await files.stat(ctx.cookie('nexus_session'), resourceId(ctx), input.path, false, signal);
			send(ctx, 200, { info: toInfo(info) } satisfies RemoteFileStatResponse);
		}),
		route('POST', '/resources/:id/read-text', async (ctx, signal) => {
			const input = readRemoteFilePathRequest(await ctx.json());
			const result = await files.readText(
				ctx.cookie('nexus_session'),
				resourceId(ctx),
				input.path,
				REMOTE_FILE_MAX_TEXT_BYTES,
				signal,
			);
			send(ctx, 200, {
				info: toInfo(result.info),
				bytes: result.bytes,
				sha256: result.sha256,
				text: result.text,
			} satisfies RemoteFileTextResponse);
		}),
		route(
			'POST',
			'/resources/:id/write-text',
			async (ctx, signal) => {
				const input = readRemoteFileWriteTextRequest(await ctx.json());
				const result = await files.writeText(
					ctx.cookie('nexus_session'),
					resourceId(ctx),
					input.path,
					input.text,
					input.expectedSha256,
					REMOTE_FILE_MAX_TEXT_BYTES,
					signal,
				);
				send(ctx, result.status === 'created' ? 201 : 200, {
					status: result.status,
					info: toInfo(result.info),
					bytes: result.bytes,
					sha256: result.sha256,
				} satisfies RemoteFileWriteTextResponse);
			},
			REMOTE_FILE_MAX_WRITE_REQUEST_BYTES,
		),
		route('POST', '/resources/:id/rename', async (ctx, signal) => {
			const input = readRemoteFileRenameRequest(await ctx.json());
			const result = await files.rename(
				ctx.cookie('nexus_session'),
				resourceId(ctx),
				input.from,
				input.to,
				signal,
			);
			send(ctx, 200, {
				from: result.from,
				to: result.to,
				kind: result.kind,
			} satisfies RemoteFileRenameResponse);
		}),
		route('POST', '/resources/:id/remove', async (ctx, signal) => {
			const input = readRemoteFilePathRequest(await ctx.json());
			const result = await files.remove(ctx.cookie('nexus_session'), resourceId(ctx), input.path, signal);
			send(ctx, 200, {
				path: result.path,
				kind: result.kind,
				removed: true,
			} satisfies RemoteFileRemoveResponse);
		}),
		route('POST', '/resources/:id/mkdir', async (ctx, signal) => {
			const input = readRemoteFilePathRequest(await ctx.json());
			const result = await files.mkdir(ctx.cookie('nexus_session'), resourceId(ctx), input.path, signal);
			send(ctx, 201, { path: result.path, created: true } satisfies RemoteFileCreateDirectoryResponse);
		}),
		route('POST', '/resources/:id/rmdir', async (ctx, signal) => {
			const input = readRemoteFilePathRequest(await ctx.json());
			const result = await files.rmdir(ctx.cookie('nexus_session'), resourceId(ctx), input.path, signal);
			send(ctx, 200, { path: result.path, removed: true } satisfies RemoteFileRemoveDirectoryResponse);
		}),
	];
}
