import type { HttpRoute } from '../../../../platform/http/http-types.js';
import type { SystemStatusService } from '../../status/service/status-service.js';
import { SystemStatusFailure } from '../../system-failure.js';
import type { LocalSystemStatusResponse, SystemHealthResponse } from '@nexus-terminal/shared/system/status/http';
import { SYSTEM_STATUS_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/system/status/values';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';

export function createSystemStatusRoutes(service: SystemStatusService): HttpRoute[] {
	return [
		{
			method: 'GET',
			path: '/api/v1/status',

			async handle(ctx) {
				try {
					if (ctx.query.size) {
						ctx.send(400, { code: 'invalid_input' });
						return;
					}
					const value = service.health();
					ctx.send(200, { status: value.status, service: value.service } satisfies SystemHealthResponse);
				} catch {
					ctx.send(503, { code: 'remote_unavailable' });
				}
			},
		},
		{
			method: 'GET',
			path: '/api/v1/system/status',

			async handle(ctx) {
				try {
					if (ctx.query.size) {
						ctx.send(400, { code: 'invalid_input' });
						return;
					}
					const value = await service.collect(ctx.cookie(ACCESS_SESSION_COOKIE_NAME));
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
					if (Buffer.byteLength(JSON.stringify(result), 'utf8') > SYSTEM_STATUS_MAX_RESPONSE_BYTES) {
						throw new SystemStatusFailure('remote_unavailable');
					}
					ctx.send(200, result);
				} catch (error) {
					const code = error instanceof SystemStatusFailure ? error.code : 'remote_unavailable';
					ctx.send(code === 'unauthenticated' ? 401 : code === 'forbidden' ? 403 : 503, { code });
				}
			},
		},
	];
}
