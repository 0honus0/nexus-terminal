import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
import type { DiagnosticService } from '../../diagnostics/service/diagnostic-service.js';
import { SystemStatusFailure } from '../../system-failure.js';
import type { HostDiagnosticResponse } from '@nexus-terminal/shared/system/diagnostics/http';
import { HOST_DIAGNOSTIC_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/system/diagnostics/values';

export function createDiagnosticRoutes(service: DiagnosticService): HttpRoute[] {
	return [
		{
			method: 'GET',
			path: '/api/v1/system/diagnostics',

			handle: async (ctx) => {
				try {
					if (ctx.query.size) {
						ctx.send(400, { code: 'invalid_input' });
						return;
					}
					const value = await service.collectAuthenticated(ctx.cookie(ACCESS_SESSION_COOKIE_NAME));
					const response: HostDiagnosticResponse = {
						diagnostics: {
							collectedAt: value.collectedAt,
							process: {
								uptimeSeconds: value.process.uptimeSeconds,
								residentBytes: value.process.residentBytes,
								heapUsedBytes: value.process.heapUsedBytes,
								runtimeVersion: value.process.runtimeVersion,
							},
							database: {
								available: value.database.available,
								schemaVersion: value.database.schemaVersion,
							},
						},
					};
					if (Buffer.byteLength(JSON.stringify(response), 'utf8') > HOST_DIAGNOSTIC_MAX_RESPONSE_BYTES) {
						throw new Error('Diagnostic response budget exceeded');
					}
					ctx.send(200, response);
				} catch (error) {
					const code =
						error instanceof SystemStatusFailure &&
						(error.code === 'unauthenticated' || error.code === 'forbidden')
							? error.code
							: 'unavailable';
					ctx.send(code === 'unauthenticated' ? 401 : code === 'forbidden' ? 403 : 503, { code });
				}
			},
		},
	];
}
