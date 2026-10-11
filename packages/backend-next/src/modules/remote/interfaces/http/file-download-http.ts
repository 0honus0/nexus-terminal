import path from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import type { RemoteFileService } from '../../files/service/file-service.js';
import {
	RemoteFileFailure,
	FileDownloadTicketFailure,
	FileRangeNotSatisfiable,
	type FileDownloadPlan,
	type FileDownloadSink,
	type FileReadSelection,
} from '../../files/model/file-types.js';
import {
	InvalidDownloadTicketRequest,
	readDownloadTicketRequest,
} from '@nexus-terminal/shared/remote/transfers/http-codec';
import type { WorkspaceDownloadTicketResponse } from '@nexus-terminal/shared/remote/transfers/http';
import { WORKSPACE_TRANSFER_MAX_INLINE_PREVIEW_BYTES } from '@nexus-terminal/shared/remote/transfers/values';

const ACTIVE_DOWNLOAD_LIMIT = 8;
const DOWNLOAD_DEADLINE_MS = 60 * 60 * 1000;
const HEAD_DEADLINE_MS = 30_000;

class InlinePreviewTooLarge extends Error {}

const INLINE_TYPES: Readonly<Record<string, string>> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.md': 'text/markdown; charset=utf-8',
	'.markdown': 'text/markdown; charset=utf-8',
	'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function disposition(kind: 'inline' | 'attachment', filePath: string): string {
	const filename = path.posix.basename(filePath);
	const fallback = filename.replace(/["\\\r\n]/gu, '_').replace(/[^\x20-\x7E]/gu, '_') || 'download';
	const encoded = encodeURIComponent(filename).replace(
		/[!'()*]/gu,
		(character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
	);
	return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function connectionId(input: string | null): number {
	const value = Number(input);
	if (!input || !Number.isSafeInteger(value) || value <= 0) {
		throw new RemoteFileFailure('invalid_input');
	}
	return value;
}

function failureStatus(error: unknown): number {
	if (error instanceof RemoteFileFailure) {
		switch (error.code) {
			case 'invalid_input':
			case 'not_text':
				return 400;
			case 'unauthenticated':
				return 401;
			case 'forbidden':
				return 403;
			case 'not_found':
				return 404;
			case 'limit_exceeded':
				return 429;
			default:
				return 503;
		}
	}
	return 500;
}

function readRangeSelection(header: string | undefined): FileReadSelection {
	if (header === undefined) {
		return { kind: 'all' };
	}
	const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
	if (!match || (!match[1] && !match[2])) {
		return { kind: 'invalid' };
	}
	if (!match[1]) {
		return { kind: 'suffix', length: Number(match[2]) };
	}
	const result: FileReadSelection = { kind: 'range', start: Number(match[1]) };
	if (match[2]) {
		result.end = Number(match[2]);
	}
	return result;
}

function downloadSink<TPlan>(
	ctx: HttpRouteContext,
	signal: AbortSignal,
	onPlan: (plan: TPlan) => Promise<void>,
): FileDownloadSink<TPlan> {
	const response = ctx.response;
	return {
		plan: onPlan,

		async write(bytes, operationSignal) {
			if (signal.aborted || operationSignal.aborted) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			if (!response.write(Buffer.from(bytes))) {
				await once(response, 'drain', { signal: operationSignal });
			}
		},

		async finish(operationSignal) {
			if (signal.aborted || operationSignal.aborted) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			response.end();
			await finished(response, { signal: operationSignal, cleanup: true });
		},
	};
}

/** Old route method/path remain stable; streams do not flow through JSON helpers. */
export function createFileDownloadHttpRoutes(files: RemoteFileService): HttpRoute[] {
	let active = 0;
	const issueTicket: HttpRoute = {
		method: 'POST',
		path: '/api/v1/sftp/download-ticket',

		async handle(ctx) {
			try {
				const payload = readDownloadTicketRequest(await ctx.json());
				const controller = new AbortController();

				const closed = () => controller.abort();

				ctx.response.once('close', closed);
				ctx.request.once('aborted', closed);
				if (ctx.request.aborted || ctx.response.destroyed) {
					closed();
				}
				try {
					const issued = await files.issueDownloadTicket(
						ctx.cookie('nexus_session'),
						payload.sessionId ?? null,
						payload.connectionId,
						payload.remotePath,
						controller.signal,
					);
					const response: WorkspaceDownloadTicketResponse = {
						url: issued.url,
						expiresInSeconds: issued.expiresInSeconds,
					};
					ctx.send(201, response, { 'Cache-Control': 'private, no-store' });
				} finally {
					ctx.response.off('close', closed);
					ctx.request.off('aborted', closed);
				}
			} catch (error) {
				ctx.send(error instanceof InvalidDownloadTicketRequest ? 400 : failureStatus(error), {
					message:
						error instanceof InvalidDownloadTicketRequest
							? 'invalid_input'
							: error instanceof RemoteFileFailure
								? error.code
								: 'Download ticket unavailable',
				});
			}
		},
	};

	const download = (method: 'GET' | 'HEAD'): HttpRoute => ({
		method,
		path: '/api/v1/sftp/download',

		async handle(ctx: HttpRouteContext): Promise<void> {
			const response = ctx.response;
			const controller = new AbortController();

			const cancelled = () => controller.abort();

			const closed = () => {
				if (!response.writableFinished) {
					controller.abort();
				}
			};

			ctx.request.once('aborted', cancelled);
			response.once('close', closed);
			const deadline = setTimeout(cancelled, method === 'HEAD' ? HEAD_DEADLINE_MS : DOWNLOAD_DEADLINE_MS);
			deadline.unref();
			if (ctx.request.aborted || response.destroyed) {
				cancelled();
			}
			let admitted = false;
			try {
				const ticket = ctx.query.get('ticket');
				const id = ticket === null ? connectionId(ctx.query.get('connectionId')) : 0;
				const workspaceId = ticket === null ? ctx.query.get('sessionId') : null;
				const remotePath = ticket === null ? ctx.query.get('remotePath') : null;
				if (ticket === null && !remotePath) {
					throw new RemoteFileFailure('invalid_input');
				}
				const kind = ticket === null && ctx.query.get('disposition') === 'inline' ? 'inline' : 'attachment';
				if (method === 'GET') {
					if (active >= ACTIVE_DOWNLOAD_LIMIT) {
						throw new RemoteFileFailure('limit_exceeded');
					}
					active++;
					admitted = true;
				}

				const plan = async (plan: FileDownloadPlan) => {
					if (controller.signal.aborted) {
						throw new RemoteFileFailure('remote_unavailable');
					}
					if (kind === 'inline' && plan.size > WORKSPACE_TRANSFER_MAX_INLINE_PREVIEW_BYTES) {
						throw new InlinePreviewTooLarge();
					}
					const headers: Record<string, string> = {
						'Content-Disposition': disposition(kind, plan.path),
						'Content-Type':
							kind === 'inline'
								? (INLINE_TYPES[path.posix.extname(plan.path).toLowerCase()] ??
									'application/octet-stream')
								: 'application/octet-stream',
						'Content-Length': String(plan.length),
						'Accept-Ranges': 'bytes',
						'X-Content-Type-Options': 'nosniff',
						'Cache-Control': 'private, no-store',
					};
					if (plan.partial) {
						headers['Content-Range'] = `bytes ${plan.start}-${plan.end}/${plan.size}`;
					}
					response.writeHead(plan.partial ? 206 : 200, headers);
				};

				const sink = downloadSink(ctx, controller.signal, plan);

				if (ticket === null) {
					const resourceKind = await files.inspectDownloadKind(
						ctx.cookie('nexus_session'),
						workspaceId,
						id,
						remotePath ?? '',
						controller.signal,
					);
					if (resourceKind === 'directory') {
						// Old GET/HEAD /download accepted directories as ZIP, not only
						// the explicitly named /download-directory route.
						if (method === 'HEAD') {
							response.writeHead(200, {
								'Content-Type': 'application/zip',
								'Cache-Control': 'private, no-store',
								'X-Content-Type-Options': 'nosniff',
							});
							response.end();
						} else {
							await files.downloadDirectory(
								ctx.cookie('nexus_session'),
								workspaceId,
								id,
								remotePath ?? '',
								downloadSink<string>(ctx, controller.signal, async (filename) => {
									response.writeHead(200, {
										'Content-Disposition': disposition('attachment', filename),
										'Content-Type': 'application/zip',
										'Cache-Control': 'private, no-store',
										'X-Content-Type-Options': 'nosniff',
									});
								}),
								controller.signal,
							);
						}
						if (method === 'HEAD') {
							await finished(response, { signal: controller.signal, cleanup: true });
						}
						return;
					}
					if (resourceKind !== 'file') {
						throw new RemoteFileFailure('invalid_input');
					}
				}

				if (ticket !== null) {
					await files.downloadTicket(
						ticket,
						ctx.sourceIp,
						readRangeSelection(ctx.request.headers.range),
						method === 'GET',
						sink,
						controller.signal,
					);
				} else {
					await files.downloadWorkspace(
						ctx.cookie('nexus_session'),
						workspaceId,
						id,
						remotePath ?? '',
						readRangeSelection(ctx.request.headers.range),
						method === 'GET',
						sink,
						controller.signal,
					);
				}
			} catch (error) {
				if (!response.headersSent && !response.destroyed) {
					if (error instanceof InlinePreviewTooLarge) {
						ctx.send(413, { message: 'File too large for inline preview' });
					} else if (error instanceof FileDownloadTicketFailure) {
						ctx.send(error.reason === 'gone' ? 410 : 423, {
							message: error.reason === 'gone' ? 'Download ticket expired' : 'Download ticket locked',
						});
					} else if (error instanceof FileRangeNotSatisfiable) {
						response.writeHead(416, {
							'Accept-Ranges': 'bytes',
							'Content-Range': `bytes */${error.fileSize}`,
							'Cache-Control': 'private, no-store',
						});
						response.end();
					} else {
						ctx.send(failureStatus(error), {
							message: error instanceof RemoteFileFailure ? error.code : 'Download unavailable',
						});
					}
				} else if (!response.writableFinished) {
					// Old code attempted JSON after a partial response in some
					// branches; bytes already delivered can only be terminated.
					response.destroy();
				}
			} finally {
				clearTimeout(deadline);
				if (admitted) {
					active--;
				}
				ctx.request.off('aborted', cancelled);
				response.off('close', closed);
			}
		},
	});

	const directoryZip: HttpRoute = {
		method: 'GET',
		path: '/api/v1/sftp/download-directory',

		async handle(ctx): Promise<void> {
			const response = ctx.response;
			const controller = new AbortController();

			const aborted = () => controller.abort();

			const closed = () => {
				if (!response.writableFinished) {
					controller.abort();
				}
			};

			ctx.request.once('aborted', aborted);
			response.once('close', closed);
			const deadline = setTimeout(aborted, DOWNLOAD_DEADLINE_MS);
			deadline.unref();
			if (ctx.request.aborted || response.destroyed) {
				aborted();
			}
			let admitted = false;
			try {
				const targetId = connectionId(ctx.query.get('connectionId'));
				const filePath = ctx.query.get('remotePath');
				if (!filePath) {
					throw new RemoteFileFailure('invalid_input');
				}
				if (active >= ACTIVE_DOWNLOAD_LIMIT) {
					throw new RemoteFileFailure('limit_exceeded');
				}
				active++;
				admitted = true;
				await files.downloadDirectory(
					ctx.cookie('nexus_session'),
					ctx.query.get('sessionId'),
					targetId,
					filePath,
					downloadSink<string>(ctx, controller.signal, async (filename) => {
						if (controller.signal.aborted) {
							throw new RemoteFileFailure('remote_unavailable');
						}
						response.writeHead(200, {
							'Content-Disposition': disposition('attachment', filename),
							'Content-Type': 'application/zip',
							'Cache-Control': 'private, no-store',
							'X-Content-Type-Options': 'nosniff',
						});
					}),
					controller.signal,
				);
			} catch (error) {
				if (!response.headersSent && !response.destroyed) {
					ctx.send(failureStatus(error), {
						message: error instanceof RemoteFileFailure ? error.code : 'Directory download unavailable',
					});
				} else if (!response.writableFinished) {
					response.destroy();
				}
			} finally {
				clearTimeout(deadline);
				if (admitted) {
					active--;
				}
				ctx.request.off('aborted', aborted);
				response.off('close', closed);
			}
		},
	};

	return [issueTicket, download('GET'), download('HEAD'), directoryZip];
}
