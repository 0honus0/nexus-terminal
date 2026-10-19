import type { RemoteHttpErrorCode } from '@nexus-terminal/shared/remote/sessions/values';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { finished } from 'node:stream/promises';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { SessionView } from '../../public.js';
import { isRemoteSessionId } from '@nexus-terminal/shared/remote/sessions/model';
import { RemoteSessionOwner } from '../../sessions/service/session-owner.js';
import { RemotePermissionError } from '../../sessions/model/session-permission-failure.js';
import { RemoteOperationError } from '../../public-errors.js';
import { RemoteHostKeyUntrustedError } from '../../machines/model/machine-errors.js';
import {
	type RemoteCloseSessionResponse,
	type RemoteFailureResponse,
	readRemoteOpenShell,
	InvalidRemotePayload,
} from '@nexus-terminal/shared/remote/sessions/http';
import { type RemoteShellView } from '@nexus-terminal/shared/remote/sessions/model';

const OPEN_DELIVERY_MS = 15_000;

const ROOT = '/api/v1/remote';

class RemoteInputError extends Error {}

function toShellView(value: SessionView): RemoteShellView {
	return {
		id: value.id,
		targetId: value.targetId,
		configurationFingerprint: value.fingerprint,
		startedAt: value.startedAt,
		status: 'open',
	};
}

function handleError(ctx: HttpRouteContext, error: unknown): void {
	if (error instanceof HttpInputFailure) {
		throw error;
	}
	if (ctx.response.destroyed || ctx.request.aborted) {
		return;
	}
	if (ctx.response.headersSent) {
		ctx.response.destroy();
		return;
	}
	if (error instanceof RemoteInputError || error instanceof InvalidRemotePayload) {
		ctx.send(400, { code: 'invalid_input' } satisfies RemoteFailureResponse);
		return;
	}
	if (error instanceof RemotePermissionError) {
		const status = remoteErrorStatus(error.code);
		ctx.send(status, { code: error.code } satisfies RemoteFailureResponse);
		return;
	}
	if (error instanceof RemoteOperationError) {
		const status = remoteErrorStatus(error.code);
		ctx.send(status, { code: error.code } satisfies RemoteFailureResponse);
		return;
	}
	if (error instanceof RemoteHostKeyUntrustedError) {
		ctx.send(422, { code: 'host_key_untrusted' } satisfies RemoteFailureResponse);
		return;
	}
	// No machine/SSH error, private credential or destination leaks to HTTP.
	ctx.send(503, { code: 'remote_unavailable' } satisfies RemoteFailureResponse);
}

function remoteErrorStatus(code: RemoteHttpErrorCode): number {
	switch (code) {
		case 'invalid_input':
			return 400;
		case 'host_key_untrusted':
			return 422;
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'not_found':
			return 404;
		case 'remote_unavailable':
			return 503;
	}
}

function route(
	method: HttpRoute['method'],
	path: string,
	handler: (ctx: HttpRouteContext) => Promise<void>,
): HttpRoute {
	return {
		method,
		path: ROOT + path,

		async handle(ctx) {
			try {
				if (ctx.query.size) {
					throw new RemoteInputError();
				}
				await handler(ctx);
			} catch (error) {
				handleError(ctx, error);
			}
		},
	};
}

export function createRemoteHttpRoutes(owner: RemoteSessionOwner): HttpRoute[] {
	return [
		route('POST', '/sessions', async (ctx) => {
			const token = ctx.cookie(ACCESS_SESSION_COOKIE_NAME);
			const v = readRemoteOpenShell(await ctx.json());
			const controller = new AbortController();

			const aborted = () => controller.abort(new Error('HTTP client disconnected'));

			ctx.request.once('aborted', aborted);

			const disconnected = () => {
				if (!ctx.response.writableFinished) {
					aborted();
				}
			};

			ctx.response.once('close', disconnected);
			if (ctx.request.aborted || ctx.response.destroyed) {
				aborted();
			}
			try {
				const opened = await owner.open(token, {
					targetId: v.targetId,
					columns: v.columns,
					rows: v.rows,
					term: v.term,
					timeoutMs: 20000,
					signal: controller.signal,
				});
				const delivery = new AbortController();
				const timer = setTimeout(() => delivery.abort(), OPEN_DELIVERY_MS);
				timer.unref();
				try {
					controller.signal.throwIfAborted();
					ctx.send(201, toShellView(opened));
					await finished(ctx.response, {
						signal: AbortSignal.any([controller.signal, delivery.signal]),
						cleanup: true,
					});
				} catch (error) {
					try {
						await owner.release(opened.id);
					} catch (cleanup) {
						throw new RemoteResourceCleanupFailure([error, cleanup]);
					}
					throw error;
				} finally {
					clearTimeout(timer);
				}
			} finally {
				ctx.request.off('aborted', aborted);
				ctx.response.off('close', disconnected);
			}
		}),
		route('GET', '/sessions/:id', async (ctx) => {
			const id = ctx.params.id;
			if (!id || !isRemoteSessionId(id)) {
				throw new RemoteInputError();
			}
			const session = await owner.get(ctx.cookie(ACCESS_SESSION_COOKIE_NAME), id);
			ctx.send(
				session ? 200 : 404,
				session ? toShellView(session) : ({ code: 'not_found' } satisfies RemoteFailureResponse),
			);
		}),
		route('DELETE', '/sessions/:id', async (ctx) => {
			const id = ctx.params.id;
			if (!id || !isRemoteSessionId(id)) {
				throw new RemoteInputError();
			}
			const deleted = await owner.closeSession(ctx.cookie(ACCESS_SESSION_COOKIE_NAME), id);
			ctx.send(
				deleted ? 200 : 404,
				deleted
					? ({ closed: true } satisfies RemoteCloseSessionResponse)
					: ({ code: 'not_found' } satisfies RemoteFailureResponse),
			);
		}),
	];
}
