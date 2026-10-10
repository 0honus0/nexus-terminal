import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-server.js';
import { HttpInputFailure } from '../../../../platform/http/http-server.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { AgentOperationError, validateAgentId, validateOperationKey } from '../../agent-errors.js';
import type {
	AgentStateApi,
	AgentRunView,
	AgentRunEventView,
	AgentCreateRunResult,
	AgentCancelRunResult,
} from '../../public.js';

const ROOT = '/api/v1/agent';
type Handler = (context: HttpRouteContext, userId: number) => Promise<void>;

function strictBody(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new AgentOperationError('invalid_input');
	}
	const object = value as Record<string, unknown>;
	if (Object.keys(object).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(object, key))) {
		throw new AgentOperationError('invalid_input');
	}
	return object;
}

function name(value: unknown, max = 128): string {
	if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > max) {
		throw new AgentOperationError('invalid_input');
	}
	return value;
}

function id(value: string | undefined): string {
	if (!value) {
		throw new AgentOperationError('invalid_input');
	}
	validateAgentId(value);
	return value.toLowerCase();
}

function operationKey(context: HttpRouteContext): string {
	const raw = context.request.headers['idempotency-key'];
	if (typeof raw !== 'string') {
		throw new AgentOperationError('invalid_input');
	}
	validateOperationKey(raw);
	return raw.toLowerCase();
}

function integer(value: unknown, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
		throw new AgentOperationError('invalid_input');
	}
	return value;
}

function queryNumber(context: HttpRouteContext, key: string, fallback: number, max: number): number {
	const values = context.query.getAll(key);
	if (values.length > 1) {
		throw new AgentOperationError('invalid_input');
	}
	if (!values.length) {
		return fallback;
	}
	const raw = values[0];
	if (!/^(0|[1-9][0-9]{0,14})$/u.test(raw)) {
		throw new AgentOperationError('invalid_input');
	}
	return integer(Number(raw), key === 'limit' ? 1 : 0, max);
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
	if (error instanceof AgentOperationError) {
		const status = agentErrorStatus(error.code);
		context.send(status, { code: error.code });
		return;
	}
	if (error instanceof AccessOperationError) {
		context.send(error.code === 'storage_unavailable' ? 503 : 500, {
			code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
		});
		return;
	}
	context.send(500, { code: 'internal_failure' });
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
	maxBodyBytes?: number,
): void {
	routes.push({
		method,
		path: ROOT + path,
		...(maxBodyBytes === undefined ? {} : { maxBodyBytes }),

		async handle(context) {
			try {
				if ([...context.query.keys()].some((key) => !queryKeys.includes(key))) {
					throw new AgentOperationError('invalid_input');
				}
				const token = context.cookie('nexus_session');
				const identity = await access.authenticate(token);
				if (identity === null) {
					context.send(401, { code: 'unauthenticated' });
					return;
				}
				if (identity.userId !== 1) {
					context.send(403, { code: 'forbidden' });
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
		context.send(404, { code: 'not_found' });
		return;
	}
	if (
		value.status === 'active_run_conflict' ||
		value.status === 'idempotency_conflict' ||
		value.status === 'version_conflict'
	) {
		context.send(409, { code: value.status });
		return;
	}
	if (value.status === 'replayed') {
		context.send(200, {
			status: 'replayed',
			originalStatus: value.originalStatus,
			run: toRun(value.run),
		});
		return;
	}
	if (value.status === 'created' || value.status === 'cancelled' || value.status === 'already_cancelled') {
		context.send(value.status === 'created' ? 201 : 200, { status: value.status, run: toRun(value.run) });
		return;
	}
	// Never silently treat a newly introduced result as a successful HTTP call.
	throw new AgentOperationError('internal_failure');
}

export function createAgentHttpRoutes(access: AccessPublicApi, agent: AgentStateApi): HttpRoute[] {
	const routes: HttpRoute[] = [];
	add(routes, 'POST', '/apps', access, async (ctx, userId) => {
		const body = strictBody(await ctx.json(), ['name']);
		const view = await agent.createApp(userId, name(body.name));
		ctx.send(201, { id: view.id, name: view.name, createdAt: view.createdAt });
	});
	add(routes, 'POST', '/apps/:appId/threads', access, async (ctx, userId) => {
		const body = strictBody(await ctx.json(), ['title']);
		const result = await agent.createThread(userId, id(ctx.params.appId), name(body.title));
		ctx.send(
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
			const body = strictBody(await ctx.json(), ['prompt']);
			const value = await agent.createRun({
				userId,
				appId: id(ctx.params.appId),
				threadId: id(ctx.params.threadId),
				prompt: name(body.prompt, 16384),
				operationKey: key,
			});
			statusResult(ctx, value);
		},
		[],
		128 * 1024,
	);
	add(routes, 'POST', '/apps/:appId/runs/:id/cancel', access, async (ctx, userId) => {
		const key = operationKey(ctx);
		const body = strictBody(await ctx.json(), ['expectedVersion']);
		const value = await agent.cancelRun({
			userId,
			appId: id(ctx.params.appId),
			runId: id(ctx.params.id),
			expectedVersion: integer(body.expectedVersion, 1, Number.MAX_SAFE_INTEGER),
			operationKey: key,
		});
		statusResult(ctx, value);
	});
	add(routes, 'GET', '/apps/:appId/runs/:id', access, async (ctx, userId) => {
		const result = await agent.getRun(userId, id(ctx.params.appId), id(ctx.params.id));
		ctx.send(result === null ? 404 : 200, result === null ? { code: 'not_found' } : toRun(result));
	});
	add(
		routes,
		'GET',
		'/apps/:appId/runs/:id/events',
		access,
		async (ctx, userId) => {
			const after = queryNumber(ctx, 'after', 0, Number.MAX_SAFE_INTEGER);
			const limit = queryNumber(ctx, 'limit', 50, 100);
			const result = await agent.listEvents(userId, id(ctx.params.appId), id(ctx.params.id), after, limit);
			ctx.send(
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
