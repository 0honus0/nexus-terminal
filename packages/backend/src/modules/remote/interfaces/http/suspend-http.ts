import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
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

function requireId(request: HttpRequest): string {
	const id = request.params.suspendSessionId;
	if (!id || !SUSPENDED_SESSION_ID_PATTERN.test(id)) {
		throw new WorkspaceFailure('invalid_input');
	}
	return id;
}

function route(
	method: HttpRoute['method'],
	path: string,
	action: (request: HttpRequest, reply: HttpReply) => Promise<void>,
): HttpRoute {
	return {
		method,
		url: ROOT + path,
		bodyLimit: SUSPENDED_MANAGEMENT_MAX_JSON_BYTES,

		async handler(request: HttpRequest, reply: HttpReply) {
			try {
				if (request.query.size) {
					throw new WorkspaceFailure('invalid_input');
				}
				await action(request, reply);
			} catch (error) {
				if (error instanceof HttpInputFailure) {
					throw error;
				}
				if (reply.raw.destroyed || request.raw.aborted) {
					return;
				}
				if (reply.raw.headersSent) {
					reply.raw.destroy(error instanceof Error ? error : new Error('Suspend stream failed'));
					return;
				}
				if (error instanceof RemoteResourceCleanupFailure) {
					reply.code(503).send({ code: 'operation_unknown' });
					return;
				}
				if (error instanceof WorkspaceFailure) {
					reply.code(suspendedHttpErrorStatus(error.code)).send({ code: error.code });
					return;
				}
				if (error instanceof InvalidSuspendedHttpPayload) {
					reply.code(400).send({ code: 'invalid_input' });
					return;
				}
				reply.code(503).send({ code: 'remote_unavailable' });
			}
		},
	};
}

/** The same WorkspaceService owns all WS/HTTP suspended management. */
export function createSuspendHttpRoutes(workspaces: WorkspaceService): HttpRoute[] {
	return [
		route('GET', '/suspended-sessions', async (request, reply) => {
			const views = await workspaces.listSuspended(readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME));
			let catalog: SuspendedSessionView[];
			try {
				catalog = readSuspendedSessionCatalog(views.map(suspendSessionView));
			} catch (cause) {
				throw new WorkspaceFailure('remote_unavailable', { cause });
			}
			reply.code(200).send(catalog);
		}),
		route('DELETE', '/remove/:suspendSessionId', async (request, reply) => {
			const suspendedSessionId = requireId(request);
			const disposition = await workspaces.removeSuspended(
				readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
				suspendedSessionId,
			);
			if (disposition === null) {
				throw new WorkspaceFailure('not_found');
			}
			reply.code(200).send({ suspendedSessionId, disposition });
		}),
		route('DELETE', '/terminate/:suspendSessionId', async (request, reply) => {
			const id = requireId(request);
			const removed = await workspaces.terminateSuspended(
				readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
				id,
			);
			if (!removed) {
				throw new WorkspaceFailure('not_found');
			}
			reply.code(200).send({ message: 'Suspended session terminated and removed.' });
		}),
		route('DELETE', '/entry/:suspendSessionId', async (request, reply) => {
			const id = requireId(request);
			const removed = await workspaces.removeDisconnectedSuspended(
				readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
				id,
			);
			if (!removed) {
				throw new WorkspaceFailure('not_found');
			}
			reply.code(200).send({ message: 'Disconnected suspended entry removed.' });
		}),
		route('PUT', '/name/:suspendSessionId', async (request, reply) => {
			const id = requireId(request);
			const input = readSuspendedSessionRename(request.body);
			await workspaces.renameSuspended(
				readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
				id,
				input.customName,
			);
			reply.code(200).send({
				message: 'Suspended session name updated.',
				customName: input.customName,
			} satisfies SuspendedSessionRenameResponse);
		}),
		route('GET', '/log/:suspendSessionId', async (request, reply) => {
			const controller = new AbortController();

			const abort = () => controller.abort(new Error('Log client disconnected'));

			const disconnected = () => {
				if (!reply.raw.writableEnded) {
					abort();
				}
			};

			request.raw.once('aborted', abort);
			reply.raw.once('close', disconnected);
			try {
				const delivered = await workspaces.deliverSuspendedLog(
					readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
					requireId(request),
					{
						deliver: async (filename, bytes, signal) => {
							signal.throwIfAborted();
							const source = Readable.from(bytes, { objectMode: false, signal });
							const sourceClosed = Promise.allSettled([finished(source, { cleanup: true })]);
							let failure: unknown = null;
							try {
								reply
									.headers({
										'Content-Disposition': 'attachment; filename="' + filename + '"',
										'Content-Type': 'text/plain; charset=utf-8',
										'Cache-Control': 'private, no-store',
									})
									.send(source);
								await finished(reply.raw, { signal, cleanup: true });
								if (!source.readableEnded || reply.statusCode !== 200) {
									throw new WorkspaceFailure('remote_unavailable');
								}
								const [result] = await sourceClosed;
								if (result.status === 'rejected') {
									throw result.reason;
								}
							} catch (error) {
								failure = error;
								if (!reply.raw.writableFinished) {
									reply.raw.destroy();
								}
							} finally {
								source.destroy();
								const [result] = await sourceClosed;
								if (result.status === 'rejected' && source.errored && result.reason !== failure) {
									failure =
										failure === null
											? result.reason
											: new AggregateError(
													[failure, result.reason],
													'Suspended log delivery failed',
												);
								}
							}
							if (failure !== null) {
								throw failure;
							}
						},
					},
					controller.signal,
				);
				if (!delivered) {
					throw new WorkspaceFailure('not_found');
				}
			} finally {
				request.raw.off('aborted', abort);
				reply.raw.off('close', disconnected);
			}
		}),
	];
}
