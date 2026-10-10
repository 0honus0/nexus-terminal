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
import type { AgentAppView, AgentThreadView } from '@nexus-terminal/shared/agent/scope/model';
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

const ROOT = '/api/v1/agent';
type Handler = (context: HttpRouteContext, userId: number) => Promise<void>;

type AgentHttpResponse =
	| AgentAppView
	| AgentThreadView
	| AgentRunView
	| AgentCreateRunResponse
	| AgentCancelRunResponse
	| AgentRunEventsResponse
	| AgentErrorResponse;

function sendAgent(context: HttpRouteContext, status: number, value: AgentHttpResponse): void {
	try {
		encodeAgentJson(value, AGENT_MAX_RESPONSE_BYTES);
	} catch {
		// A producer exceeding its contract is a server failure, not invalid user input.
		throw new AgentOperationError('internal_failure');
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
		status: value.status,
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

function agentErrorStatus(code: AgentOperationError['code']): number {
	switch (code) {
		case 'invalid_input':
			return 400;
		case 'not_found':
			return 404;
		case 'active_run_conflict':
		case 'idempotency_conflict':
		case 'version_conflict':
			return 409;
		case 'storage_unavailable':
			return 503;
		case 'internal_failure':
			return 500;
	}
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
				const token = context.cookie('nexus_session');
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

function statusResult(context: HttpRouteContext, value: AgentCreateRunResult | AgentCancelRunResult): void {
	if (value.status === 'scope_not_found' || value.status === 'not_found') {
		sendAgent(context, 404, { code: 'not_found' });
		return;
	}
	if (
		value.status === 'active_run_conflict' ||
		value.status === 'idempotency_conflict' ||
		value.status === 'version_conflict'
	) {
		sendAgent(context, 409, { code: value.status });
		return;
	}
	if (value.status === 'replayed') {
		sendAgent(context, 200, {
			status: 'replayed',
			originalStatus: value.originalStatus,
			run: toRun(value.run),
		});
		return;
	}
	if (value.status === 'created') {
		sendAgent(context, 201, { status: 'created', run: toRun(value.run) });
		return;
	}
	if (value.status === 'cancelled' || value.status === 'already_cancelled') {
		sendAgent(context, 200, { status: value.status, run: toRun(value.run) });
		return;
	}
	// Never silently treat a newly introduced result as a successful HTTP call.
	throw new AgentOperationError('internal_failure');
}

export function createAgentHttpRoutes(access: AccessPublicApi, agent: AgentStateApi): HttpRoute[] {
	const routes: HttpRoute[] = [];
	add(routes, 'POST', '/apps', access, async (ctx, userId) => {
		const body = readAgentCreateAppRequest(await ctx.json());
		const view = await agent.createApp(userId, body.name);
		sendAgent(ctx, 201, { id: view.id, name: view.name, createdAt: view.createdAt });
	});
	add(routes, 'POST', '/apps/:appId/threads', access, async (ctx, userId) => {
		const body = readAgentCreateThreadRequest(await ctx.json());
		const path = readAgentAppPath(ctx.params);
		const result = await agent.createThread(userId, path.appId, body.title);
		sendAgent(
			ctx,
			result === null ? 404 : 201,
			result === null
				? { code: 'not_found' }
				: { id: result.id, appId: result.appId, title: result.title, createdAt: result.createdAt },
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
				operationKey: key,
			});
			statusResult(ctx, value);
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
		statusResult(ctx, value);
	});
	add(routes, 'GET', '/apps/:appId/runs/:id', access, async (ctx, userId) => {
		const path = runPath(ctx);
		const result = await agent.getRun(userId, path.appId, path.runId);
		sendAgent(ctx, result === null ? 404 : 200, result === null ? { code: 'not_found' } : toRun(result));
	});
	add(
		routes,
		'GET',
		'/apps/:appId/runs/:id/events',
		access,
		async (ctx, userId) => {
			const query = readAgentRunEventsQuery(ctx.query);
			const path = runPath(ctx);
			const result = await agent.listEvents(userId, path.appId, path.runId, query.after, query.limit);
			sendAgent(
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
	return routes;
}
