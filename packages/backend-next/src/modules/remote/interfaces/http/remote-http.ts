import type { RemoteHttpErrorCode } from '@nexus-terminal/shared/remote/sessions/values';
import type {
	HttpRoute,
	HttpRouteContext,
} from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { AccessPublicApi } from '../../../access/public.js';
import type { SessionView } from '../../public.js';
import { isRemoteSessionId } from '@nexus-terminal/shared/remote/sessions/model';
import { RemoteSessionOwner } from '../../sessions/service/session-owner.js';
import { RemotePermissionError } from '../../sessions/model/session-permission-failure.js';
import { RemoteOperationError } from '../../public-errors.js';
import { RemoteHostKeyUntrustedError } from '../../sessions/model/session-errors.js';
import {
	type RemoteCloseSessionResponse,
	type RemoteFailureResponse,
	readRemoteOpenShell,
	InvalidRemotePayload,
} from '@nexus-terminal/shared/remote/sessions/http';
import { type RemoteShellView } from '@nexus-terminal/shared/remote/sessions/model';

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

async function identity(access: AccessPublicApi, token: string | null): Promise<void> {
	if (!token) {
		throw new RemotePermissionError('unauthenticated');
	}
	const user = await access.authenticate(token);
	if (!user) {
		throw new RemotePermissionError('unauthenticated');
	}
	if (user.userId !== 1) {
		throw new RemotePermissionError('forbidden');
	}
}

function handleError(ctx: HttpRouteContext, error: unknown): void {
	if (error instanceof HttpInputFailure) {
		throw error;
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

export function createRemoteHttpRoutes(owner: RemoteSessionOwner, access: AccessPublicApi): HttpRoute[] {
	return [
		route('POST', '/sessions', async (ctx) => {
			const token = ctx.cookie('nexus_session');
			await identity(access, token);
			const v = readRemoteOpenShell(await ctx.json());
			const controller = new AbortController();

			const aborted = () => controller.abort(new Error('HTTP client disconnected'));

			ctx.request.once('aborted', aborted);

			const disconnected = () => {
				if (!ctx.response.writableEnded) {
					aborted();
				}
			};

			ctx.response.once('close', disconnected);
			try {
				const opened = await owner.open(token, {
					targetId: v.targetId,
					columns: v.columns,
					rows: v.rows,
					term: v.term,
					timeoutMs: 20000,
					signal: controller.signal,
				});
				if (controller.signal.aborted) {
					await owner.release(opened.id);
					return;
				}
				ctx.send(201, toShellView(opened));
			} finally {
				ctx.request.off('aborted', aborted);
				ctx.response.off('close', disconnected);
			}
		}),
		route('GET', '/sessions/:id', async (ctx) => {
			await identity(access, ctx.cookie('nexus_session'));
			const id = ctx.params.id;
			if (!id || !isRemoteSessionId(id)) {
				throw new RemoteInputError();
			}
			const session = await owner.get(ctx.cookie('nexus_session'), id);
			ctx.send(
				session ? 200 : 404,
				session ? toShellView(session) : ({ code: 'not_found' } satisfies RemoteFailureResponse),
			);
		}),
		route('DELETE', '/sessions/:id', async (ctx) => {
			await identity(access, ctx.cookie('nexus_session'));
			const id = ctx.params.id;
			if (!id || !isRemoteSessionId(id)) {
				throw new RemoteInputError();
			}
			const deleted = await owner.closeSession(ctx.cookie('nexus_session'), id);
			ctx.send(
				deleted ? 200 : 404,
				deleted
					? ({ closed: true } satisfies RemoteCloseSessionResponse)
					: ({ code: 'not_found' } satisfies RemoteFailureResponse),
			);
		}),
	];
}
