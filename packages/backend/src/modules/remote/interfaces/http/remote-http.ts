import { readRequestCookie } from '../../../../platform/http/http-request.js';
import type { RemoteHttpErrorCode } from '@nexus-terminal/shared/remote/sessions/values';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { finished } from 'node:stream/promises';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
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

function handleError(request: HttpRequest, reply: HttpReply, error: unknown): void {
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
	if (error instanceof RemoteInputError || error instanceof InvalidRemotePayload) {
		reply.code(400).send({ code: 'invalid_input' } satisfies RemoteFailureResponse);
		return;
	}
	if (error instanceof RemotePermissionError) {
		const status = remoteErrorStatus(error.code);
		reply.code(status).send({ code: error.code } satisfies RemoteFailureResponse);
		return;
	}
	if (error instanceof RemoteOperationError) {
		const status = remoteErrorStatus(error.code);
		reply.code(status).send({ code: error.code } satisfies RemoteFailureResponse);
		return;
	}
	if (error instanceof RemoteHostKeyUntrustedError) {
		reply.code(422).send({ code: 'host_key_untrusted' } satisfies RemoteFailureResponse);
		return;
	}
	// No machine/SSH error, private credential or destination leaks to HTTP.
	reply.code(503).send({ code: 'remote_unavailable' } satisfies RemoteFailureResponse);
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
	handler: (request: HttpRequest, reply: HttpReply) => Promise<void>,
): HttpRoute {
	return {
		method,
		url: ROOT + path,

		async handler(request: HttpRequest, reply: HttpReply) {
			try {
				if (request.query.size) {
					throw new RemoteInputError();
				}
				await handler(request, reply);
			} catch (error) {
				handleError(request, reply, error);
			}
		},
	};
}

export function createRemoteHttpRoutes(owner: RemoteSessionOwner): HttpRoute[] {
	return [
		route('POST', '/sessions', async (request, reply) => {
			const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
			const v = readRemoteOpenShell(request.body);
			const controller = new AbortController();

			const aborted = () => controller.abort(new Error('HTTP client disconnected'));

			request.raw.once('aborted', aborted);

			const disconnected = () => {
				if (!reply.raw.writableFinished) {
					aborted();
				}
			};

			reply.raw.once('close', disconnected);
			if (request.raw.aborted || reply.raw.destroyed) {
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
					controller.signal.throwIfAborted();
					reply.code(201).send(toShellView(opened));
					await finished(reply.raw, {
						signal: AbortSignal.any([controller.signal, delivery.signal]),
						cleanup: true,
					});
					if (!delivered) {
						throw new RemoteOperationError('remote_unavailable');
					}
				} catch (error) {
					try {
						await owner.release(opened.id);
					} catch (cleanup) {
						throw new RemoteResourceCleanupFailure([error, cleanup]);
					}
					throw error;
				} finally {
					clearTimeout(timer);
					reply.raw.off('finish', finishedDelivery);
				}
			} finally {
				request.raw.off('aborted', aborted);
				reply.raw.off('close', disconnected);
			}
		}),
		route('GET', '/sessions/:id', async (request, reply) => {
			const id = request.params.id;
			if (!id || !isRemoteSessionId(id)) {
				throw new RemoteInputError();
			}
			const session = await owner.get(readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME), id);
			reply
				.code(session ? 200 : 404)
				.send(session ? toShellView(session) : ({ code: 'not_found' } satisfies RemoteFailureResponse));
		}),
		route('DELETE', '/sessions/:id', async (request, reply) => {
			const id = request.params.id;
			if (!id || !isRemoteSessionId(id)) {
				throw new RemoteInputError();
			}
			const deleted = await owner.closeSession(readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME), id);
			reply
				.code(deleted ? 200 : 404)
				.send(
					deleted
						? ({ closed: true } satisfies RemoteCloseSessionResponse)
						: ({ code: 'not_found' } satisfies RemoteFailureResponse),
				);
		}),
	];
}
