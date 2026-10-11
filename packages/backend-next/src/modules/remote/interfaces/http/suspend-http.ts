import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { WorkspaceService } from '../../sessions/service/workspace-service.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { WorkspaceFailure } from '../../sessions/model/workspace-types.js';
import {
	InvalidWorkspaceSuspendPayload,
	readWorkspaceSuspendHttpRename,
} from '@nexus-terminal/shared/remote/suspend/workspace-codec';
import type { SuspendedSessionView, SuspendedSessionRenameResponse } from '@nexus-terminal/shared/remote/suspend/http';
import { suspendSessionView } from '../suspend-view.js';

const ROOT = '/api/v1/ssh-suspend';
const SAFE_ID = /^[A-Za-z0-9_-]{8,128}$/u;

function status(code: WorkspaceFailure['code']): number {
	switch (code) {
		case 'invalid_input':
			return 400;
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'not_found':
			return 404;
		case 'conflict':
			return 409;
		case 'limit_exceeded':
			return 429;
		case 'operation_unknown':
			return 503;
		case 'remote_unavailable':
			return 503;
	}
}

function requireId(ctx: HttpRouteContext): string {
	const id = ctx.params.suspendSessionId;
	if (!id || !SAFE_ID.test(id)) {
		throw new WorkspaceFailure('invalid_input');
	}
	return id;
}

function route(method: HttpRoute['method'], path: string, action: (ctx: HttpRouteContext) => Promise<void>): HttpRoute {
	return {
		method,
		path: ROOT + path,

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
					ctx.send(status(error.code), { code: error.code });
					return;
				}
				if (error instanceof InvalidWorkspaceSuspendPayload) {
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
			const views = await workspaces.listSuspended(ctx.cookie('nexus_session'));
			ctx.send(200, views.map(suspendSessionView) satisfies SuspendedSessionView[]);
		}),
		route('DELETE', '/terminate/:suspendSessionId', async (ctx) => {
			const id = requireId(ctx);
			const removed = await workspaces.terminateSuspended(ctx.cookie('nexus_session'), id);
			if (!removed) {
				throw new WorkspaceFailure('not_found');
			}
			ctx.send(200, { message: 'Suspended session terminated and removed.' });
		}),
		route('DELETE', '/entry/:suspendSessionId', async (ctx) => {
			const id = requireId(ctx);
			const removed = await workspaces.removeDisconnectedSuspended(ctx.cookie('nexus_session'), id);
			if (!removed) {
				throw new WorkspaceFailure('not_found');
			}
			ctx.send(200, { message: 'Disconnected suspended entry removed.' });
		}),
		route('PUT', '/name/:suspendSessionId', async (ctx) => {
			const id = requireId(ctx);
			const input = readWorkspaceSuspendHttpRename(await ctx.json());
			await workspaces.renameSuspended(ctx.cookie('nexus_session'), id, input.customName);
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
					ctx.cookie('nexus_session'),
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
