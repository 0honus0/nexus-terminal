import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import type { ObservationErrorCode } from '@nexus-terminal/shared/remote/monitoring/values';
import {
	InvalidObservationPayload,
	readSshResourceStatusPath,
} from '@nexus-terminal/shared/remote/monitoring/http-codec';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import type { ResourceStatusService } from '../../monitoring/service/resource-status-service.js';
import { ObservationFailure } from '../../monitoring/model/observation-types.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { OBSERVATION_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/remote/monitoring/values';
import { observedResource } from '../observation-view.js';

const STATUS: Record<ObservationErrorCode, number> = {
	invalid_input: 400,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	limit_exceeded: 429,
	conflict: 409,
	remote_unavailable: 503,
	command_failed: 502,
	operation_unknown: 503,
	host_key_untrusted: 403,
};

function errorCode(error: unknown): ObservationErrorCode {
	if (error instanceof InvalidObservationPayload) {
		return 'invalid_input';
	}
	if (error instanceof ObservationFailure) {
		return error.code;
	}
	if (error instanceof RemoteResourceCleanupFailure) {
		return 'operation_unknown';
	}
	return 'remote_unavailable';
}

export function createResourceStatusRoutes(service: ResourceStatusService): HttpRoute[] {
	return ['/api/v1/system/ssh-resources', '/api/v1/system/ssh-resources/:connectionId'].map((path): HttpRoute => ({
		method: 'GET',
		url: path,

		errorHandler(error, _request, reply) {
			if (!(error instanceof ObservationFailure)) {
				throw error;
			}
			reply.removeHeader('Set-Cookie');
			reply.type('application/json; charset=utf-8').serializer(JSON.stringify);
			const code = errorCode(error);
			reply.code(STATUS[code]).send({ code });
		},

		async handler(request: HttpRequest, reply: HttpReply) {
			const controller = new AbortController();

			const abort = () => controller.abort();

			const disconnected = () => {
				if (!reply.raw.writableEnded) {
					abort();
				}
			};

			request.raw.once('aborted', abort);
			reply.raw.once('close', disconnected);
			if (request.raw.aborted || reply.raw.destroyed) {
				abort();
			}
			try {
				if (request.query.size) {
					throw new ObservationFailure('invalid_input');
				}
				const id =
					request.params.connectionId === undefined
						? undefined
						: readSshResourceStatusPath(request.params).connectionId;
				const rows = (
					await service.list(
						readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
						id,
						controller.signal,
					)
				).map(observedResource);
				const result = id === undefined ? rows : rows[0];
				if (result === undefined) {
					throw new ObservationFailure('not_found');
				}
				reply.type('application/json; charset=utf-8').serializer((payload) => {
					let encoded: string;
					try {
						encoded = JSON.stringify(payload);
					} catch {
						throw new ObservationFailure('remote_unavailable');
					}
					if (Buffer.byteLength(encoded, 'utf8') > OBSERVATION_MAX_RESPONSE_BYTES) {
						throw new ObservationFailure('limit_exceeded');
					}
					return encoded;
				});
				if (!reply.raw.destroyed) {
					reply.code(200).send(result);
				}
			} catch (error) {
				if (reply.raw.destroyed) {
					return;
				}
				const code = errorCode(error);
				const status = STATUS[code];
				reply.code(status).send({ code });
			} finally {
				request.raw.off('aborted', abort);
				reply.raw.off('close', disconnected);
			}
		},
	}));
}
