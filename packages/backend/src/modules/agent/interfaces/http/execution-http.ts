import type { AgentOperationErrorCode } from '@nexus-terminal/shared/agent/values';
import { agentHttpSerializer, agentHttpErrorHandler } from './agent-http-response.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { AgentHttpInput } from './agent-input.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { AGENT_EXECUTION_SETTINGS_MAX_BYTES } from '@nexus-terminal/shared/agent/execution/values';
import {
	readAgentExecutionSettingsUpdate,
	readAgentHardLimitPreview,
	readAgentHardLimitConfirm,
} from '@nexus-terminal/shared/agent/execution/http-codec';
import { InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import type { ExecutionService } from '../../execution/service/execution-service.js';
import type { ExecutionActor } from '../../execution/model/execution-types.js';
import { AgentOperationError } from '../../public-errors.js';
import { agentErrorStatus } from './agent-http-status.js';
import { fromExecutionLimits, toExecutionSettings, toHardLimitPreview } from './execution-mapper.js';

function send(
	reply: HttpReply,
	status: number,
	value: unknown,
	failureCode: AgentOperationErrorCode = 'limit_exceeded',
): void {
	reply
		.type('application/json; charset=utf-8')
		.serializer(agentHttpSerializer(AGENT_EXECUTION_SETTINGS_MAX_BYTES, failureCode))
		.code(status)
		.send(value);
}

export function createExecutionHttpRoutes(
	access: AccessPublicApi,
	service: ExecutionService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute[] {
	const routes: HttpRoute[] = [];

	function add(
		method: HttpRoute['method'],
		path: string,
		action: (request: HttpRequest, actor: ExecutionActor) => Promise<unknown>,
	): void {
		routes.push({
			method,
			url: '/api/v1/agent' + path,
			bodyLimit: AGENT_EXECUTION_SETTINGS_MAX_BYTES,
			errorHandler: agentHttpErrorHandler,

			async handler(request, reply) {
				const inputBoundary = new AgentHttpInput(request);
				let completed = false;
				try {
					const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
					const current = await access.authenticate(token);
					if (!token || !current) {
						send(reply, 401, { code: 'unauthenticated' });
						return;
					}
					if (current.userId !== 1) {
						send(reply, 403, { code: 'forbidden' });
						return;
					}
					if ([...request.query.keys()].length) {
						throw new InvalidAgentPayload();
					}
					const result = await boundary(() =>
						inputBoundary.normalize(() => action(request, { userId: current.userId, token })),
					);
					completed = method !== 'GET';
					const latest = await access.authenticate(token);
					if (!latest || latest.userId !== current.userId) {
						if (completed) {
							throw new AgentOperationError('operation_unknown');
						}
						send(reply, 401, { code: 'unauthenticated' });
						return;
					}
					send(reply, 200, result, completed ? 'operation_unknown' : 'limit_exceeded');
				} catch (error) {
					if (completed) {
						send(reply, 503, { code: 'operation_unknown' });
						return;
					}
					if (error instanceof InvalidAgentPayload) {
						send(reply, 400, { code: 'invalid_input' });
					} else if (error instanceof AgentOperationError) {
						send(reply, agentErrorStatus(error.code), { code: error.code });
					} else if (error instanceof AccessOperationError) {
						send(reply, 503, {
							code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
						});
					} else {
						send(reply, 500, { code: 'internal_failure' });
					}
				}
			},
		});
	}

	add('GET', '/execution-settings', async (_ctx, actor) => ({
		settings: toExecutionSettings(await service.get(actor.userId)),
	}));
	add('PUT', '/execution-settings', async (request, actor) => {
		const input = readAgentExecutionSettingsUpdate(request.body);
		return {
			settings: toExecutionSettings(
				await service.update(actor, input.expectedVersion, input.enabled, fromExecutionLimits(input.limits)),
			),
		};
	});
	add('POST', '/execution-settings/hard-limits/preview', async (request, actor) => {
		const input = readAgentHardLimitPreview(request.body);
		return {
			confirmation: toHardLimitPreview(
				await service.preview(actor, input.expectedVersion, fromExecutionLimits(input.proposed)),
			),
		};
	});
	add('POST', '/execution-settings/hard-limits/confirm', async (request, actor) => {
		const input = readAgentHardLimitConfirm(request.body);
		return { settings: toExecutionSettings(await service.confirm(actor, input.confirmationId)) };
	});
	return routes;
}
