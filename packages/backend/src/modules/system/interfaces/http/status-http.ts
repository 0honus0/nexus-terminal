import { readRequestCookie } from '../../../../platform/http/http-request.js';
import type { HttpRoute, HttpReply } from '../../../../platform/http/http-types.js';
import type { SystemStatusService } from '../../status/service/status-service.js';
import { SystemStatusFailure } from '../../system-failure.js';
import type { LocalSystemStatusResponse, SystemHealthResponse } from '@nexus-terminal/shared/system/status/http';
import { SYSTEM_STATUS_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/system/status/values';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';

function sendStatusError(reply: HttpReply, error: unknown): void {
	const code = error instanceof SystemStatusFailure ? error.code : 'remote_unavailable';
	reply.code(code === 'unauthenticated' ? 401 : code === 'forbidden' ? 403 : 503).send({ code });
}

export function createSystemStatusRoutes(service: SystemStatusService): HttpRoute[] {
	return [
		{
			method: 'GET',
			url: '/api/v1/status',

			async handler(request, reply) {
				try {
					if (request.query.size) {
						reply.code(400).send({ code: 'invalid_input' });
						return;
					}
					const value = service.health();
					reply
						.code(200)
						.send({ status: value.status, service: value.service } satisfies SystemHealthResponse);
				} catch {
					reply.code(503).send({ code: 'remote_unavailable' });
				}
			},
		},
		{
			method: 'GET',
			url: '/api/v1/system/status',

			errorHandler(error, _request, reply) {
				if (!(error instanceof SystemStatusFailure)) {
					throw error;
				}
				reply.removeHeader('Set-Cookie');
				reply.type('application/json; charset=utf-8').serializer(JSON.stringify);
				sendStatusError(reply, error);
			},

			async handler(request, reply) {
				try {
					if (request.query.size) {
						reply.code(400).send({ code: 'invalid_input' });
						return;
					}
					const value = await service.collect(readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME));
					const result: LocalSystemStatusResponse = {
						cpuPercent: value.cpuPercent,
						memPercent: value.memPercent,
						memUsed: value.memUsed,
						memTotal: value.memTotal,
						diskPercent: value.diskPercent,
						diskUsed: value.diskUsed,
						diskTotal: value.diskTotal,
						cpuModel: value.cpuModel,
						osName: value.osName,
						uptimeSeconds: value.uptimeSeconds,
					};
					reply.type('application/json; charset=utf-8').serializer((payload) => {
						let encoded: string;
						try {
							encoded = JSON.stringify(payload);
						} catch {
							throw new SystemStatusFailure('remote_unavailable');
						}
						if (Buffer.byteLength(encoded, 'utf8') > SYSTEM_STATUS_MAX_RESPONSE_BYTES) {
							throw new SystemStatusFailure('remote_unavailable');
						}
						return encoded;
					});
					reply.code(200).send(result);
				} catch (error) {
					sendStatusError(reply, error);
				}
			},
		},
	];
}
