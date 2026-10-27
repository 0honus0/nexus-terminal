import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { WorkspaceService } from '../../sessions/service/workspace-service.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { WorkspaceFailure } from '../../sessions/model/workspace-types.js';
import {
	InvalidSuspendedHttpPayload,
	readSuspendedSessionRename,
	readSuspendedSessionCatalog,
} from '@nexus-terminal/shared/remote/suspend/http-codec';
import {
	SUSPENDED_SESSION_ID_PATTERN,
	SUSPENDED_MANAGEMENT_MAX_JSON_BYTES,
	suspendedHttpErrorStatus,
} from '@nexus-terminal/shared/remote/suspend/values';
import type { SuspendedSessionView, SuspendedSessionRenameResponse } from '@nexus-terminal/shared/remote/suspend/http';
import { suspendSessionView } from '../suspend-view.js';

const ROOT = '/api/v1/ssh-suspend';

function requireId(ctx: HttpRouteContext): string {
	const id = ctx.params.suspendSessionId;
	if (!id || !SUSPENDED_SESSION_ID_PATTERN.test(id)) {
		throw new WorkspaceFailure('invalid_input');
	}
	return id;
}

function route(method: HttpRoute['method'], path: string, action: (ctx: HttpRouteContext) => Promise<void>): HttpRoute {
	return {
		method,
		path: ROOT + path,
		maxBodyBytes: SUSPENDED_MANAGEMENT_MAX_JSON_BYTES,

		async handle(ctx) {
			try {
				if (ctx.query.size) {
					throw new WorkspaceFailure('invalid_input');
				}
				await action(ctx);
			} catch (error) {
				if (error instanceof HttpInputFailure) {
					throw error;
				}
				if (ctx.response.destroyed || ctx.request.aborted) {
					return;
				}
				if (ctx.response.headersSent) {
					ctx.response.destroy(error instanceof Error ? error : new Error('Suspend stream failed'));
					return;
				}
				if (error instanceof RemoteResourceCleanupFailure) {
					ctx.send(503, { code: 'operation_unknown' });
					return;
				}
				if (error instanceof WorkspaceFailure) {
					ctx.send(suspendedHttpErrorStatus(error.code), { code: error.code });
					return;
				}
				if (error instanceof InvalidSuspendedHttpPayload) {
					ctx.send(400, { code: 'invalid_input' });
					return;
				}
				ctx.send(503, { code: 'remote_unavailable' });
			}
		},
	};
}

/** The same WorkspaceService owns all WS/HTTP suspended management. */
export function createSuspendHttpRoutes(workspaces: WorkspaceService): HttpRoute[] {
	return [
		route('GET', '/suspended-sessions', async (ctx) => {
			const views = await workspaces.listSuspended(ctx.cookie(ACCESS_SESSION_COOKIE_NAME));
			let catalog: SuspendedSessionView[];
			try {
				catalog = readSuspendedSessionCatalog(views.map(suspendSessionView));
			} catch (cause) {
				throw new WorkspaceFailure('remote_unavailable', { cause });
			}
			ctx.send(200, catalog);
		}),
		route('DELETE', '/remove/:suspendSessionId', async (ctx) => {
			const suspendedSessionId = requireId(ctx);
			const disposition = await workspaces.removeSuspended(
				ctx.cookie(ACCESS_SESSION_COOKIE_NAME),
				suspendedSessionId,
			);
			if (disposition === null) {
				throw new WorkspaceFailure('not_found');
			}
			ctx.send(200, { suspendedSessionId, disposition });
		}),
		route('DELETE', '/terminate/:suspendSessionId', async (ctx) => {
			const id = requireId(ctx);
			const removed = await workspaces.terminateSuspended(ctx.cookie(ACCESS_SESSION_COOKIE_NAME), id);
			if (!removed) {
				throw new WorkspaceFailure('not_found');
			}
			ctx.send(200, { message: 'Suspended session terminated and removed.' });
		}),
		route('DELETE', '/entry/:suspendSessionId', async (ctx) => {
			const id = requireId(ctx);
			const removed = await workspaces.removeDisconnectedSuspended(ctx.cookie(ACCESS_SESSION_COOKIE_NAME), id);
			if (!removed) {
				throw new WorkspaceFailure('not_found');
			}
			ctx.send(200, { message: 'Disconnected suspended entry removed.' });
		}),
		route('PUT', '/name/:suspendSessionId', async (ctx) => {
			const id = requireId(ctx);
			const input = readSuspendedSessionRename(await ctx.json());
			await workspaces.renameSuspended(ctx.cookie(ACCESS_SESSION_COOKIE_NAME), id, input.customName);
			ctx.send(200, {
				message: 'Suspended session name updated.',
				customName: input.customName,
			} satisfies SuspendedSessionRenameResponse);
		}),
		route('GET', '/log/:suspendSessionId', async (ctx) => {
			const controller = new AbortController();

			const abort = () => controller.abort(new Error('Log client disconnected'));

			const disconnected = () => {
				if (!ctx.response.writableEnded) {
					abort();
				}
			};

			ctx.request.once('aborted', abort);
			ctx.response.once('close', disconnected);
			try {
				const delivered = await workspaces.deliverSuspendedLog(
					ctx.cookie(ACCESS_SESSION_COOKIE_NAME),
					requireId(ctx),
					{
						deliver: async (filename, bytes, signal) => {
							signal.throwIfAborted();
							ctx.response.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
							ctx.response.setHeader('Content-Type', 'text/plain; charset=utf-8');
							await pipeline(Readable.from(bytes), ctx.response, { signal });
						},
					},
					controller.signal,
				);
				if (!delivered) {
					throw new WorkspaceFailure('not_found');
				}
			} finally {
				ctx.request.off('aborted', abort);
				ctx.response.off('close', disconnected);
			}
		}),
	];
}
