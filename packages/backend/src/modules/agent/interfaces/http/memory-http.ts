import { AgentHttpInput } from './agent-input.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	AGENT_MEMORY_MAX_BODY_BYTES,
	AGENT_MEMORY_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/memory/values';
import {
	readAgentMemoryPath,
	readAgentMemoryProposal,
	readAgentMemoryReview,
	readAgentMemoryListQuery,
} from '@nexus-terminal/shared/agent/memory/http-codec';
import { readAgentGovernanceAppPath } from '@nexus-terminal/shared/agent/governance/http-codec';
import { encodeAgentJson, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type { AgentMemoryView } from '@nexus-terminal/shared/agent/memory/model';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import type { MemoryService } from '../../memory/service/memory-service.js';
import type { MemoryRecord, MemoryActor } from '../../memory/model/memory-types.js';
import { AgentOperationError } from '../../public-errors.js';
import { agentErrorStatus } from './agent-http-status.js';

function toWire(value: MemoryRecord): AgentMemoryView {
	return {
		id: value.id,
		appId: value.appId,
		content: value.content,
		confidence: value.confidence,
		status: value.status,
		sourceRunId: value.sourceRunId,
		expiresAt: value.expiresAt,
		reviewAction: value.reviewAction,
		reviewedAt: value.reviewedAt,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function send(ctx: HttpRouteContext, status: number, value: unknown): void {
	try {
		encodeAgentJson(value, AGENT_MEMORY_MAX_RESPONSE_BYTES);
	} catch {
		throw new AgentOperationError('limit_exceeded');
	}
	ctx.send(status, value);
}

export function createMemoryHttpRoutes(
	access: AccessPublicApi,
	service: MemoryService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute[] {
	const routes: HttpRoute[] = [];

	function add(
		method: HttpRoute['method'],
		path: string,
		action: (ctx: HttpRouteContext, actor: MemoryActor) => Promise<unknown>,
		status = 200,
	): void {
		routes.push({
			method,
			path: '/api/v1/agent/apps/:appId' + path,
			maxBodyBytes: AGENT_MEMORY_MAX_BODY_BYTES,

			async handle(ctx) {
				const inputBoundary = new AgentHttpInput(ctx);
				let completed = false;
				try {
					const token = ctx.cookie(ACCESS_SESSION_COOKIE_NAME);
					const identity = await access.authenticate(token);
					if (!token || !identity) {
						send(ctx, 401, { code: 'unauthenticated' });
						return;
					}
					if (identity.userId !== 1) {
						send(ctx, 403, { code: 'forbidden' });
						return;
					}
					const appId = readAgentGovernanceAppPath({ appId: ctx.params.appId }).appId;
					if (method !== 'GET' && [...ctx.query.keys()].length) {
						throw new InvalidAgentPayload();
					}
					const result = await boundary(() =>
						inputBoundary.normalize(() =>
							action(ctx, { kind: 'session', userId: identity.userId, appId, token }),
						),
					);
					completed = method !== 'GET';
					const current = await access.authenticate(token);
					if (!current || current.userId !== identity.userId) {
						if (completed) {
							throw new AgentOperationError('operation_unknown');
						}
						send(ctx, 401, { code: 'unauthenticated' });
						return;
					}
					send(ctx, status, result);
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
						send(ctx, error.code === 'storage_unavailable' ? 503 : 500, {
							code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
						});
					} else {
						send(ctx, 500, { code: 'internal_failure' });
					}
				}
			},
		});
	}

	add('GET', '/memories', async (ctx, actor) => {
		const query = readAgentMemoryListQuery(ctx.query);
		const page = await service.list(actor, {
			status: query.status,
			limit: query.limit,
			offset: query.offset,
			threadId: query.threadId,
		});
		return { items: page.items.map(toWire), nextOffset: page.nextOffset };
	});
	add(
		'POST',
		'/memories',
		async (ctx, actor) => {
			const input = readAgentMemoryProposal(await ctx.json());
			return {
				memory: toWire(
					await service.propose(actor, {
						content: input.content,
						confidence: input.confidence,
						expiresAt: input.expiresAt,
						sourceRunId: input.sourceRunId,
					}),
				),
			};
		},
		201,
	);
	add('GET', '/memories/:memoryId', async (ctx, actor) => {
		if ([...ctx.query.keys()].length) {
			throw new InvalidAgentPayload();
		}
		const path = readAgentMemoryPath(ctx.params);
		const result = await service.get(actor, path.memoryId);
		if (!result) {
			throw new AgentOperationError('not_found');
		}
		return { memory: toWire(result) };
	});
	add('POST', '/memories/:memoryId/review', async (ctx, actor) => {
		const path = readAgentMemoryPath(ctx.params);
		const input = readAgentMemoryReview(await ctx.json());
		return {
			memory: toWire(
				await service.review(actor, path.memoryId, {
					expectedVersion: input.expectedVersion,
					decision: input.decision,
					content: input.content,
				}),
			),
		};
	});
	return routes;
}
