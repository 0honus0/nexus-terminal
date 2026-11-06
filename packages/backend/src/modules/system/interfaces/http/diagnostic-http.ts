import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import type { HttpRoute, HttpReply } from '../../../../platform/http/http-types.js';
import type { DiagnosticService } from '../../diagnostics/service/diagnostic-service.js';
import { SystemStatusFailure } from '../../system-failure.js';
import {
	HOST_DIAGNOSTIC_PATH,
	hostDiagnosticRouteSchema,
	type HostDiagnosticResponse,
} from '@nexus-terminal/shared/system/diagnostics/http';
import { readHostDiagnosticResponse } from '@nexus-terminal/shared/system/diagnostics/http-codec';

function sendDiagnosticError(reply: HttpReply, error: unknown): void {
	const code =
		error instanceof SystemStatusFailure && (error.code === 'unauthenticated' || error.code === 'forbidden')
			? error.code
			: 'unavailable';
	reply.code(code === 'unauthenticated' ? 401 : code === 'forbidden' ? 403 : 503).send({ code });
}

export function createDiagnosticRoutes(service: DiagnosticService): HttpRoute[] {
	return [
		{
			method: 'GET',
			url: HOST_DIAGNOSTIC_PATH,
			schema: hostDiagnosticRouteSchema(),

			errorHandler(error, _request, reply) {
				if (!(error instanceof SystemStatusFailure)) {
					throw error;
				}
				reply.removeHeader('Set-Cookie');
				reply.type('application/json; charset=utf-8').serializer(JSON.stringify);
				sendDiagnosticError(reply, error);
			},

			handler: async (request, reply) => {
				try {
					if (request.query.size) {
						reply.code(400).send({ code: 'invalid_input' });
						return;
					}
					const value = await service.collectAuthenticated(
						readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
					);
					const response: HostDiagnosticResponse = {
						diagnostics: {
							collectedAt: value.collectedAt,
							process: {
								uptimeSeconds: value.process.uptimeSeconds,
								residentBytes: value.process.residentBytes,
								heapUsedBytes: value.process.heapUsedBytes,
								runtimeVersion: value.process.runtimeVersion,
								heapTotalBytes: value.process.heapTotalBytes,
								externalBytes: value.process.externalBytes,
								arrayBufferBytes: value.process.arrayBufferBytes,
								cpuUserSeconds: value.process.cpuUserSeconds,
								cpuSystemSeconds: value.process.cpuSystemSeconds,
								gcCount: value.process.gcCount,
								gcDurationSeconds: value.process.gcDurationSeconds,
							},
							modules: value.modules.map((module) => ({
								id: module.id,
								status: module.status,
								metrics: module.metrics.map((metric) => ({
									name: metric.name,
									unit: metric.unit,
									value: metric.value,
								})),
							})),
							database: {
								available: value.database.available,
								schemaVersion: value.database.schemaVersion,
							},
						},
					};
					reply.code(200).send(readHostDiagnosticResponse(response));
				} catch (error) {
					sendDiagnosticError(reply, error);
				}
			},
		},
	];
}
