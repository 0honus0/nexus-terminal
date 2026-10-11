import type { ObservationErrorCode } from '@nexus-terminal/shared/remote/monitoring/values';
import {
	InvalidObservationPayload,
	readSshResourceStatusPath,
} from '@nexus-terminal/shared/remote/monitoring/http-codec';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
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

export function createResourceStatusRoutes(service: ResourceStatusService): HttpRoute[] {
	return ['/api/v1/system/ssh-resources', '/api/v1/system/ssh-resources/:connectionId'].map((path): HttpRoute => ({
		method: 'GET',
		path,

		async handle(ctx) {
			const controller = new AbortController();

			const abort = () => controller.abort();

			const disconnected = () => {
				if (!ctx.response.writableEnded) {
					abort();
				}
			};

			ctx.request.once('aborted', abort);
			ctx.response.once('close', disconnected);
			if (ctx.request.aborted || ctx.response.destroyed) {
				abort();
			}
			try {
				if (ctx.query.size) {
					throw new ObservationFailure('invalid_input');
				}
				const id =
					ctx.params.connectionId === undefined
						? undefined
						: readSshResourceStatusPath(ctx.params).connectionId;
				const rows = (await service.list(ctx.cookie('nexus_session'), id, controller.signal)).map(
					observedResource,
				);
				const result = id === undefined ? rows : rows[0];
				if (result === undefined) {
					throw new ObservationFailure('not_found');
				}
				if (Buffer.byteLength(JSON.stringify(result), 'utf8') > OBSERVATION_MAX_RESPONSE_BYTES) {
					throw new ObservationFailure('limit_exceeded');
				}
				if (!ctx.response.destroyed) {
					ctx.send(200, result);
				}
			} catch (error) {
				if (ctx.response.destroyed) {
					return;
				}
				let code: ObservationErrorCode = 'remote_unavailable';
				if (error instanceof InvalidObservationPayload) {
					code = 'invalid_input';
				} else if (error instanceof ObservationFailure) {
					code = error.code;
				} else if (error instanceof RemoteResourceCleanupFailure) {
					code = 'operation_unknown';
				}
				const status = STATUS[code];
				ctx.send(status, { code });
			} finally {
				ctx.request.off('aborted', abort);
				ctx.response.off('close', disconnected);
			}
		},
	}));
}
