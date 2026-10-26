import type { AgentRunUsageView } from '@nexus-terminal/shared/agent/runs/model';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { AGENT_APP_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/scope/values';
import { readAgentAppStateUpdateRequest } from '@nexus-terminal/shared/agent/scope/http-codec';
import {
	parseAgentToolListCursor,
	readAgentThreadToolsPath,
	readAgentThreadToolsQuery,
} from '@nexus-terminal/shared/agent/tools/http-codec';
import { AGENT_TOOL_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/tools/values';
import type { AgentToolView } from '@nexus-terminal/shared/agent/tools/model';
import type { AgentThreadToolsResponse } from '@nexus-terminal/shared/agent/tools/http';
import { agentErrorStatus } from './agent-http-status.js';
import { InvalidAgentPayload, encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import { AGENT_MAX_JSON_BODY_BYTES, AGENT_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/values';
import { AGENT_RUN_MAX_JSON_BODY_BYTES, AGENT_RUN_IDEMPOTENCY_HEADER } from '@nexus-terminal/shared/agent/runs/values';
import {
	readAgentAppPath,
	readAgentCreateAppRequest,
	readAgentCreateThreadRequest,
} from '@nexus-terminal/shared/agent/scope/http-codec';
import {
	readAgentCreateRunRequest,
	readAgentCancelRunRequest,
	readAgentRunCommandHeaders,
	readAgentRunEventsQuery,
	readAgentCreateRunPath,
	readAgentRunPath,
} from '@nexus-terminal/shared/agent/runs/http-codec';
import type { AgentAppView, AgentAppDefinitionView, AgentThreadView } from '@nexus-terminal/shared/agent/scope/model';
import type { AgentRunView, AgentRunEventView } from '@nexus-terminal/shared/agent/runs/model';
import type {
	AgentCreateRunResponse,
	AgentCancelRunResponse,
	AgentRunEventsResponse,
	AgentRunPath,
} from '@nexus-terminal/shared/agent/runs/http';
import type { AgentErrorResponse } from '@nexus-terminal/shared/agent/http';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { AgentOperationError } from '../../public-errors.js';
import type { AgentStateApi, AgentCreateRunResult, AgentCancelRunResult } from '../../public.js';
import {
	readAgentChildPath,
	readAgentMessageMetadataQuery,
} from '@nexus-terminal/shared/agent/collaboration/http-codec';
import { AGENT_COLLABORATION_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/collaboration/values';
import type {
	AgentChildrenResponse,
	AgentMessageMetadataResponse,
} from '@nexus-terminal/shared/agent/collaboration/http';

const ROOT = '/api/v1/agent';
type Handler = (context: HttpRouteContext, userId: number) => Promise<void>;

type AgentHttpResponse =
	| AgentAppView
	| AgentChildrenResponse
	| AgentMessageMetadataResponse
	| AgentAppView[]
	| AgentAppDefinitionView[]
	| AgentThreadView
	| AgentRunUsageView
	| AgentRunView
	| AgentCreateRunResponse
	| AgentCancelRunResponse
	| AgentRunEventsResponse
	| AgentToolView
	| AgentThreadToolsResponse
	| AgentErrorResponse;

function sendAgent(
	context: HttpRouteContext,
	status: number,
	value: AgentHttpResponse,
	maxBytes = AGENT_MAX_RESPONSE_BYTES,
): void {
	try {
		encodeAgentJson(value, maxBytes);
	} catch {
		// A producer exceeding its contract is a server failure, not invalid user input.
		throw new AgentOperationError('limit_exceeded');
	}
	context.send(status, value);
}

function operationKey(context: HttpRouteContext): string {
	return readAgentRunCommandHeaders(context.request.headers[AGENT_RUN_IDEMPOTENCY_HEADER.toLowerCase()]).operationKey;
}

function runPath(context: HttpRouteContext): AgentRunPath {
	return readAgentRunPath({ appId: context.params.appId, runId: context.params.id });
}

function toRun(value: AgentRunView): AgentRunView {
	return {
		id: value.id,
		appId: value.appId,
		threadId: value.threadId,
		approvalMode: value.approvalMode,
		status: value.status,
		failure: value.failure === null ? null : { code: value.failure.code, toolName: value.failure.toolName },
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function toEvent(value: AgentRunEventView): AgentRunEventView {
	return {
		runId: value.runId,
		sequence: value.sequence,
		type: value.type,
		runVersion: value.runVersion,
		createdAt: value.createdAt,
	};
}

function failure(context: HttpRouteContext, error: unknown): void {
	if (error instanceof HttpInputFailure) {
		throw error;
	}
	if (error instanceof InvalidAgentPayload) {
		sendAgent(context, 400, { code: 'invalid_input' });
		return;
	}
	if (error instanceof AgentOperationError) {
		const status = agentErrorStatus(error.code);
		sendAgent(context, status, { code: error.code });
		return;
	}
	if (error instanceof AccessOperationError) {
		sendAgent(context, error.code === 'storage_unavailable' ? 503 : 500, {
			code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
		});
		return;
	}
	sendAgent(context, 500, { code: 'internal_failure' });
}

function add(
	routes: HttpRoute[],
	method: HttpRoute['method'],
	path: string,
	access: AccessPublicApi,
	action: Handler,
	queryKeys: readonly string[] = [],
	maxBodyBytes = AGENT_MAX_JSON_BODY_BYTES,
): void {
	routes.push({
		method,
		path: ROOT + path,
		maxBodyBytes,

		async handle(context) {
			try {
				if ([...context.query.keys()].some((key) => !queryKeys.includes(key))) {
					throw new AgentOperationError('invalid_input');
				}
				const token = context.cookie(ACCESS_SESSION_COOKIE_NAME);
				const identity = await access.authenticate(token);
				if (identity === null) {
					sendAgent(context, 401, { code: 'unauthenticated' });
					return;
				}
				if (identity.userId !== 1) {
					sendAgent(context, 403, { code: 'forbidden' });
					return;
				}
				await action(context, identity.userId);
			} catch (error) {
				failure(context, error);
			}
		},
	});
}

function toMutationResponse(value: AgentCreateRunResult | AgentCancelRunResult): {
	status: number;
	value: AgentCreateRunResponse | AgentCancelRunResponse | AgentErrorResponse;
} {
	if (value.status === 'scope_not_found' || value.status === 'not_found') {
		return { status: 404, value: { code: 'not_found' } };
	}
	if (
		value.status === 'active_run_conflict' ||
		value.status === 'idempotency_conflict' ||
		value.status === 'version_conflict'
	) {
		return { status: 409, value: { code: value.status } };
	}
	if (value.status === 'replayed') {
		return {
			status: 200,
			value: {
				status: 'replayed',
				originalStatus: value.originalStatus,
				run: toRun(value.run),
			},
		};
	}
	if (value.status === 'created') {
		return { status: 201, value: { status: 'created', run: toRun(value.run) } };
	}
	if (value.status === 'provider_unavailable') {
		return { status: 503, value: { code: 'provider_unavailable' } };
	}
	if (value.status === 'cancelled' || value.status === 'already_cancelled') {
		return { status: 200, value: { status: value.status, run: toRun(value.run) } };
	}
	// Never silently treat a newly introduced result as a successful HTTP call.
	throw new AgentOperationError('internal_failure');
}

export function createAgentHttpRoutes(access: AccessPublicApi, agent: AgentStateApi): HttpRoute[] {
	const routes: HttpRoute[] = [];

	async function deliver(
		ctx: HttpRouteContext,
		status: number,
		value: AgentHttpResponse,
		maxBytes = AGENT_MAX_RESPONSE_BYTES,
	): Promise<void> {
		const identity = await access.authenticate(ctx.cookie(ACCESS_SESSION_COOKIE_NAME));
		if (identity === null) {
			sendAgent(ctx, 401, { code: 'unauthenticated' });
			return;
		}
		if (identity.userId !== 1) {
			sendAgent(ctx, 403, { code: 'forbidden' });
			return;
		}
		sendAgent(ctx, status, value, maxBytes);
	}

	add(routes, 'GET', '/apps/:appId/runs/:id/subagents', access, async (ctx, userId) => {
		const path = runPath(ctx);
		const result = await agent.listChildren(userId, path.appId, path.runId);
		await deliver(
			ctx,
			result === null ? 404 : 200,
			result === null
				? { code: 'not_found' }
				: {
						items: result.items.map((child) => ({
							id: child.id,
							parentId: child.parentId,
							status: child.status,
							version: child.version,
							profile: child.profile,
							deadlineAt: child.deadlineAt,
						})),
					},
			AGENT_COLLABORATION_MAX_RESPONSE_BYTES,
		);
	});
	add(routes, 'POST', '/apps/:appId/runs/:id/subagents/:childId/cancel', access, async (ctx, userId) => {
		const path = readAgentChildPath({ appId: ctx.params.appId, runId: ctx.params.id, childId: ctx.params.childId });
		const key = operationKey(ctx);
		const body = readAgentCancelRunRequest(await ctx.json());
		const result = await agent.cancelChild(
			{ userId, appId: path.appId, runId: path.runId, expectedVersion: body.expectedVersion, operationKey: key },
			path.childId,
		);
		const response = toMutationResponse(result);
		await deliver(ctx, response.status, response.value);
	});
	add(
		routes,
		'GET',
		'/apps/:appId/runs/:id/subagents/:childId/messages',
		access,
		async (ctx, userId) => {
			const path = readAgentChildPath({
				appId: ctx.params.appId,
				runId: ctx.params.id,
				childId: ctx.params.childId,
			});
			const query = readAgentMessageMetadataQuery(ctx.query);
			const result = await agent.listChildMessages(
				userId,
				path.appId,
				path.runId,
				path.childId,
				query.after,
				query.limit,
			);
			await deliver(
				ctx,
				result === null ? 404 : 200,
				result === null
					? { code: 'not_found' }
					: {
							items: result.items.map((item) => ({
								sequence: item.sequence,
								senderId: item.senderId,
								bodyBytes: item.bodyBytes,
								expiresAt: item.expiresAt,
							})),
							nextCursor: result.nextCursor,
						},
				AGENT_COLLABORATION_MAX_RESPONSE_BYTES,
			);
		},
		['after', 'limit'],
	);

	add(routes, 'GET', '/app-definitions', access, async (ctx) => {
		const values = await agent.listAppDefinitions();
		await deliver(
			ctx,
			200,
			values.map((value) => ({
				id: value.id,
				version: value.version,
				displayName: value.displayName,
				capabilities: value.capabilities.map((capability) => capability),
				defaultEnabled: value.defaultEnabled,
			})),
			AGENT_APP_MAX_RESPONSE_BYTES,
		);
	});
	add(routes, 'GET', '/apps', access, async (ctx, userId) => {
		await deliver(ctx, 200, (await agent.listApps(userId)).map(toApp), AGENT_APP_MAX_RESPONSE_BYTES);
	});
	add(routes, 'GET', '/apps/:appId', access, async (ctx, userId) => {
		const appId = readAgentAppPath(ctx.params).appId;
		const value = await agent.getApp(userId, appId);
		await deliver(ctx, value === null ? 404 : 200, value === null ? { code: 'not_found' } : toApp(value));
	});
	add(routes, 'PATCH', '/apps/:appId', access, async (ctx, userId) => {
		const appId = readAgentAppPath(ctx.params).appId;
		const input = readAgentAppStateUpdateRequest(await ctx.json());
		const value = await agent.setAppEnabled(userId, appId, input.enabled, input.expectedVersion);
		await deliver(ctx, value === null ? 404 : 200, value === null ? { code: 'not_found' } : toApp(value));
	});
	add(routes, 'POST', '/apps', access, async (ctx, userId) => {
		const body = readAgentCreateAppRequest(await ctx.json());
		const view = await agent.createApp(userId, body.name, body.definitionId);
		await deliver(ctx, 201, toApp(view));
	});
	add(routes, 'POST', '/apps/:appId/threads', access, async (ctx, userId) => {
		const body = readAgentCreateThreadRequest(await ctx.json());
		const path = readAgentAppPath(ctx.params);
		const result = await agent.createThread(userId, path.appId, body.title);
		await deliver(
			ctx,
			result === null ? 404 : 201,
			result === null
				? { code: 'not_found' }
				: {
						id: result.id,
						appId: result.appId,
						title: result.title,
						version: result.version,
						createdAt: result.createdAt,
						updatedAt: result.updatedAt,
					},
		);
	});
	add(
		routes,
		'POST',
		'/apps/:appId/threads/:threadId/runs',
		access,
		async (ctx, userId) => {
			const key = operationKey(ctx);
			const body = readAgentCreateRunRequest(await ctx.json());
			const path = readAgentCreateRunPath(ctx.params);
			const value = await agent.createRun({
				userId,
				appId: path.appId,
				threadId: path.threadId,
				prompt: body.prompt,
				approvalMode: body.approvalMode,
				connectionIds: body.connectionIds.map((id) => id),
				model: {
					providerId: body.model.providerId,
					modelId: body.model.modelId,
					configurationVersion: body.model.configurationVersion,
					...(body.model.reasoningEffort === undefined
						? {}
						: { reasoningEffort: body.model.reasoningEffort }),
				},
				operationKey: key,
			});
			const response = toMutationResponse(value);
			await deliver(ctx, response.status, response.value);
		},
		[],
		AGENT_RUN_MAX_JSON_BODY_BYTES,
	);
	add(routes, 'POST', '/apps/:appId/runs/:id/cancel', access, async (ctx, userId) => {
		const key = operationKey(ctx);
		const body = readAgentCancelRunRequest(await ctx.json());
		const path = runPath(ctx);
		const value = await agent.cancelRun({
			userId,
			appId: path.appId,
			runId: path.runId,
			expectedVersion: body.expectedVersion,
			operationKey: key,
		});
		const response = toMutationResponse(value);
		await deliver(ctx, response.status, response.value);
	});
	add(routes, 'GET', '/apps/:appId/runs/:id', access, async (ctx, userId) => {
		const path = runPath(ctx);
		const result = await agent.getRun(userId, path.appId, path.runId);
		await deliver(ctx, result === null ? 404 : 200, result === null ? { code: 'not_found' } : toRun(result));
	});
	add(
		routes,
		'GET',
		'/apps/:appId/threads/:threadId/tools',
		access,
		async (ctx, userId) => {
			const path = readAgentThreadToolsPath({
				appId: ctx.params.appId,
				threadId: ctx.params.threadId,
			});
			const query = readAgentThreadToolsQuery(ctx.query);
			const result = await agent.listThreadTools(
				userId,
				path.appId,
				path.threadId,
				query.before === null ? null : parseAgentToolListCursor(query.before),
				query.limit,
			);
			await deliver(
				ctx,
				result === null ? 404 : 200,
				result === null
					? { code: 'not_found' }
					: {
							items: result.items.map(toTool),
							nextCursor: result.nextCursor,
						},
				AGENT_TOOL_MAX_RESPONSE_BYTES,
			);
		},
		['before', 'limit'],
	);
	add(
		routes,
		'GET',
		'/apps/:appId/runs/:id/events',
		access,
		async (ctx, userId) => {
			const query = readAgentRunEventsQuery(ctx.query);
			const path = runPath(ctx);
			const result = await agent.listEvents(userId, path.appId, path.runId, query.after, query.limit);
			await deliver(
				ctx,
				result === null ? 404 : 200,
				result === null
					? { code: 'not_found' }
					: {
							items: result.items.map(toEvent),
							nextCursor: result.nextCursor,
						},
			);
		},
		['after', 'limit'],
	);
	add(routes, 'GET', '/apps/:appId/runs/:id/usage', access, async (ctx, userId) => {
		const path = runPath(ctx);
		const value = await agent.getUsage(userId, path.appId, path.runId);
		await deliver(
			ctx,
			value === null ? 404 : 200,
			value === null
				? { code: 'not_found' }
				: {
						runId: value.runId,
						runVersion: value.runVersion,
						inputTokens: value.inputTokens,
						outputTokens: value.outputTokens,
						reportedModelRequests: value.reportedModelRequests,
						modelRequests: value.modelRequests,
						toolExecutions: value.toolExecutions,
					},
		);
	});

	return routes;
}

function toApp(value: AgentAppView): AgentAppView {
	return {
		id: value.id,
		name: value.name,
		definitionId: value.definitionId,
		definitionVersion: value.definitionVersion,
		capabilities: value.capabilities.map((capability) => capability),
		enabled: value.enabled,
		version: value.version,
		executionState: value.executionState,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function toTool(value: AgentToolView): AgentToolView {
	return {
		id: value.id,
		appId: value.appId,
		runId: value.runId,
		modelStepIndex: value.modelStepIndex,
		toolName: value.toolName,
		toolVersion: value.toolVersion,
		capability: value.capability,
		targetId: value.targetId,
		targetVersion: value.targetVersion,
		risk: value.risk,
		mutation: value.mutation,
		summary: value.summary,
		operationHash: value.operationHash,
		operationRevision: value.operationRevision,
		revision: value.revision,
		state: value.state,
		generatedImageId: value.generatedImageId,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}
