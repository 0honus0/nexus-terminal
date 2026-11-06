import type { AgentOperationErrorCode } from '@nexus-terminal/shared/agent/values';
import { agentHttpSerializer, agentHttpErrorHandler } from './agent-http-response.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
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
import { InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type { AgentMemoryView } from '@nexus-terminal/shared/agent/memory/model';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
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

function send(
	reply: HttpReply,
	status: number,
	value: unknown,
	failureCode: AgentOperationErrorCode = 'limit_exceeded',
): void {
	reply
		.type('application/json; charset=utf-8')
		.serializer(agentHttpSerializer(AGENT_MEMORY_MAX_RESPONSE_BYTES, failureCode))
		.code(status)
		.send(value);
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
		action: (request: HttpRequest, actor: MemoryActor) => Promise<unknown>,
		status = 200,
	): void {
		routes.push({
			method,
			url: '/api/v1/agent/apps/:appId' + path,
			bodyLimit: AGENT_MEMORY_MAX_BODY_BYTES,
			errorHandler: agentHttpErrorHandler,

			async handler(request, reply) {
				const inputBoundary = new AgentHttpInput(request);
				let completed = false;
				try {
					const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
					const identity = await access.authenticate(token);
					if (!token || !identity) {
						send(reply, 401, { code: 'unauthenticated' });
						return;
					}
					if (identity.userId !== 1) {
						send(reply, 403, { code: 'forbidden' });
						return;
					}
					const appId = readAgentGovernanceAppPath({ appId: request.params.appId }).appId;
					if (method !== 'GET' && [...request.query.keys()].length) {
						throw new InvalidAgentPayload();
					}
					const result = await boundary(() =>
						inputBoundary.normalize(() =>
							action(request, { kind: 'session', userId: identity.userId, appId, token }),
						),
					);
					completed = method !== 'GET';
					const current = await access.authenticate(token);
					if (!current || current.userId !== identity.userId) {
						if (completed) {
							throw new AgentOperationError('operation_unknown');
						}
						send(reply, 401, { code: 'unauthenticated' });
						return;
					}
					send(reply, status, result, completed ? 'operation_unknown' : 'limit_exceeded');
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
						send(reply, error.code === 'storage_unavailable' ? 503 : 500, {
							code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
						});
					} else {
						send(reply, 500, { code: 'internal_failure' });
					}
				}
			},
		});
	}

	add('GET', '/memories', async (request, actor) => {
		const query = readAgentMemoryListQuery(request.query);
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
		async (request, actor) => {
			const input = readAgentMemoryProposal(request.body);
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
	add('GET', '/memories/:memoryId', async (request, actor) => {
		if ([...request.query.keys()].length) {
			throw new InvalidAgentPayload();
		}
		const path = readAgentMemoryPath(request.params);
		const result = await service.get(actor, path.memoryId);
		if (!result) {
			throw new AgentOperationError('not_found');
		}
		return { memory: toWire(result) };
	});
	add('POST', '/memories/:memoryId/review', async (request, actor) => {
		const path = readAgentMemoryPath(request.params);
		const input = readAgentMemoryReview(request.body);
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
