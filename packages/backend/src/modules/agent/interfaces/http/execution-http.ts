import { AgentHttpInput } from './agent-input.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { AGENT_EXECUTION_SETTINGS_MAX_BYTES } from '@nexus-terminal/shared/agent/execution/values';
import {
	readAgentExecutionSettingsUpdate,
	readAgentHardLimitPreview,
	readAgentHardLimitConfirm,
} from '@nexus-terminal/shared/agent/execution/http-codec';
import { InvalidAgentPayload, encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import type { ExecutionService } from '../../execution/service/execution-service.js';
import type { ExecutionActor } from '../../execution/model/execution-types.js';
import { AgentOperationError } from '../../public-errors.js';
import { agentErrorStatus } from './agent-http-status.js';
import {
	fromExecutionLimits,
	fromExecutionProfile,
	toExecutionSettings,
	toHardLimitPreview,
} from './execution-mapper.js';

function send(ctx: HttpRouteContext, status: number, value: unknown): void {
	try {
		encodeAgentJson(value, AGENT_EXECUTION_SETTINGS_MAX_BYTES);
	} catch {
		throw new AgentOperationError('limit_exceeded');
	}
	ctx.send(status, value);
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
		action: (ctx: HttpRouteContext, actor: ExecutionActor) => Promise<unknown>,
	): void {
		routes.push({
			method,
			path: '/api/v1/agent' + path,
			maxBodyBytes: AGENT_EXECUTION_SETTINGS_MAX_BYTES,

			async handle(ctx) {
				const inputBoundary = new AgentHttpInput(ctx);
				let completed = false;
				try {
					const token = ctx.cookie(ACCESS_SESSION_COOKIE_NAME);
					const current = await access.authenticate(token);
					if (!token || !current) {
						send(ctx, 401, { code: 'unauthenticated' });
						return;
					}
					if (current.userId !== 1) {
						send(ctx, 403, { code: 'forbidden' });
						return;
					}
					if ([...ctx.query.keys()].length) {
						throw new InvalidAgentPayload();
					}
					const result = await boundary(() =>
						inputBoundary.normalize(() => action(ctx, { userId: current.userId, token })),
					);
					completed = method !== 'GET';
					const latest = await access.authenticate(token);
					if (!latest || latest.userId !== current.userId) {
						if (completed) {
							throw new AgentOperationError('operation_unknown');
						}
						send(ctx, 401, { code: 'unauthenticated' });
						return;
					}
					send(ctx, 200, result);
				} catch (error) {
					if (inputBoundary.transportFailure) {
						throw inputBoundary.transportFailure;
					}
					if (completed) {
						send(ctx, 503, { code: 'operation_unknown' });
						return;
					}
					if (error instanceof HttpInputFailure) {
						throw error;
					}
					if (error instanceof InvalidAgentPayload) {
						send(ctx, 400, { code: 'invalid_input' });
					} else if (error instanceof AgentOperationError) {
						send(ctx, agentErrorStatus(error.code), { code: error.code });
					} else if (error instanceof AccessOperationError) {
						send(ctx, 503, {
							code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
						});
					} else {
						send(ctx, 500, { code: 'internal_failure' });
					}
				}
			},
		});
	}

	add('GET', '/execution-settings', async (_ctx, actor) => ({
		settings: toExecutionSettings(await service.get(actor.userId)),
	}));
	add('PUT', '/execution-settings', async (ctx, actor) => {
		const input = readAgentExecutionSettingsUpdate(await ctx.json());
		return {
			settings: toExecutionSettings(
				await service.update(
					actor,
					input.expectedVersion,
					input.enabled,
					fromExecutionLimits(input.limits),
					input.profiles.map(fromExecutionProfile),
				),
			),
		};
	});
	add('POST', '/execution-settings/hard-limits/preview', async (ctx, actor) => {
		const input = readAgentHardLimitPreview(await ctx.json());
		return {
			confirmation: toHardLimitPreview(
				await service.preview(actor, input.expectedVersion, fromExecutionLimits(input.proposed)),
			),
		};
	});
	add('POST', '/execution-settings/hard-limits/confirm', async (ctx, actor) => {
		const input = readAgentHardLimitConfirm(await ctx.json());
		return { settings: toExecutionSettings(await service.confirm(actor, input.confirmationId)) };
	});
	return routes;
}
