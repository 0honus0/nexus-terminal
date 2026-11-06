import { agentHttpSerializer, agentHttpErrorHandler } from './agent-http-response.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { deliverArtifactContent } from './artifact-http-delivery.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { readAgentId, agentRecord, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import {
	readAgentPluginIntentCreate,
	readAgentPluginIntentQuery,
} from '@nexus-terminal/shared/agent/plugins/intent-http-codec';
import {
	AGENT_PLUGIN_INTENT_MAX_BODY_BYTES,
	AGENT_PLUGIN_INTENT_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/plugins/intent-values';
import { readAgentArtifactDownloadRange } from '@nexus-terminal/shared/agent/artifacts/http-codec';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import type { PluginIntentService } from '../../plugins/service/plugin-intent-service.js';
import type { PluginIntentSessionActor } from '../../plugins/model/plugin-intent-types.js';
import { AgentOperationError } from '../../public-errors.js';
import { AgentFailure } from '../../agent-failure.js';
import { agentErrorStatus } from './agent-http-status.js';
import { AgentHttpInput } from './agent-input.js';
import { toArtifactView } from './artifact-mapper.js';
import { toPluginIntent, toPluginIntentInput } from './plugin-intent-mapper.js';

export function createPluginIntentHttpRoutes(
	access: AccessPublicApi,
	service: PluginIntentService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute[] {
	const routes: HttpRoute[] = [];

	function send(request: HttpRequest, reply: HttpReply, status: number, value: unknown): void {
		reply
			.type('application/json; charset=utf-8')
			.serializer(
				agentHttpSerializer(
					AGENT_PLUGIN_INTENT_MAX_RESPONSE_BYTES,
					request.method === 'GET' ? 'limit_exceeded' : 'operation_unknown',
				),
			)
			.code(status)
			.send(value);
	}

	function add(
		method: HttpRoute['method'],
		suffix: string,
		action: (
			request: HttpRequest,
			reply: HttpReply,
			actor: PluginIntentSessionActor,
			signal: AbortSignal,
			input: AgentHttpInput,
		) => Promise<void>,
	): void {
		routes.push({
			method,
			url: '/api/v1/agent/apps/:appId/plugin-intents' + suffix,
			bodyLimit: AGENT_PLUGIN_INTENT_MAX_BODY_BYTES,
			errorHandler: agentHttpErrorHandler,

			async handler(request, reply) {
				const input = new AgentHttpInput(request),
					aborted = new AbortController();

				const closed = () => {
					if (!reply.raw.writableEnded) {
						aborted.abort();
					}
				};

				reply.raw.once('close', closed);
				try {
					if (suffix !== '' || method !== 'GET') {
						if ([...request.query.keys()].length) {
							throw new InvalidAgentPayload();
						}
					}
					const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
						identity = await access.authenticate(token);
					if (!token || !identity) {
						send(request, reply, 401, { code: 'unauthenticated' });
						return;
					}
					if (identity.userId !== 1) {
						send(request, reply, 403, { code: 'forbidden' });
						return;
					}
					const actor: PluginIntentSessionActor = {
						userId: identity.userId,
						appId: readAgentId(request.params.appId),
						token,
						authorization: { kind: 'session' },
					};
					const signal = AbortSignal.any([aborted.signal, AbortSignal.timeout(60000)]);
					await boundary(() => input.normalize(() => action(request, reply, actor, signal, input), signal));
				} catch (error) {
					if (reply.sent || reply.raw.headersSent || reply.raw.destroyed || reply.raw.writableEnded) {
						reply.raw.destroy();
						return;
					}
					if (error instanceof InvalidAgentPayload) {
						send(request, reply, 400, { code: 'invalid_input' });
					} else if (error instanceof AgentOperationError) {
						send(request, reply, agentErrorStatus(error.code), { code: error.code });
					} else if (error instanceof AccessOperationError) {
						send(request, reply, 503, {
							code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
						});
					} else {
						send(request, reply, 500, { code: 'internal_failure' });
					}
				} finally {
					reply.raw.off('close', closed);
				}
			},
		});
	}

	async function confirm(
		request: HttpRequest,
		reply: HttpReply,
		actor: PluginIntentSessionActor,
		signal?: AbortSignal,
	): Promise<void> {
		try {
			if (
				(await access.authenticate(actor.token))?.userId !== actor.userId ||
				reply.raw.destroyed ||
				signal?.aborted
			) {
				throw new AgentFailure(request.method === 'GET' ? 'unauthenticated' : 'operation_unknown');
			}
		} catch (error) {
			if (error instanceof AgentFailure) {
				throw error;
			}
			const code =
				error instanceof AccessOperationError && error.code === 'storage_unavailable'
					? 'storage_unavailable'
					: 'internal_failure';
			throw new AgentFailure(request.method === 'GET' ? code : 'operation_unknown', { cause: error });
		}
	}

	add('POST', '', async (request, reply, actor, signal, input) => {
		const payload = await input.read(readAgentPluginIntentCreate, signal);
		signal.throwIfAborted();
		const value = await service.create(actor, toPluginIntentInput(payload), signal);
		await confirm(request, reply, actor, signal);
		send(request, reply, 201, { receipt: toPluginIntent(value) });
	});
	add('GET', '', async (request, reply, actor) => {
		const items = await service.list(actor, readAgentPluginIntentQuery(request.query).limit);
		await confirm(request, reply, actor);
		send(request, reply, 200, { items: items.map(toPluginIntent) });
	});
	add('DELETE', '/:receiptId', async (request, reply, actor, signal, input) => {
		await input.read((value) => agentRecord(value, []), signal);
		signal.throwIfAborted();
		await service.revoke(actor, readAgentId(request.params.receiptId), signal);
		await confirm(request, reply, actor, signal);
		send(request, reply, 200, { revoked: true });
	});
	add('GET', '/:receiptId/artifacts/:artifactId', async (request, reply, actor) => {
		const value = await service.artifact(
			actor,
			readAgentId(request.params.receiptId),
			readAgentId(request.params.artifactId),
		);
		await confirm(request, reply, actor);
		send(request, reply, 200, { artifact: toArtifactView(value) });
	});
	add('GET', '/:receiptId/artifacts/:artifactId/content', async (request, reply, actor, signal) => {
		const receiptId = readAgentId(request.params.receiptId),
			artifactId = readAgentId(request.params.artifactId);
		const value = await service.artifact(actor, receiptId, artifactId);
		const range = readAgentArtifactDownloadRange(request.headers.range, value.sizeBytes);
		await confirm(request, reply, actor);
		const status = range.partial ? 206 : 200;
		reply.code(status).headers({
			'Content-Type': 'application/octet-stream',
			'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(value.name),
			'Cache-Control': 'no-store',
			'Accept-Ranges': 'bytes',
			ETag: '"' + value.version + '"',
			'Content-Length': Math.max(0, range.endInclusive - range.start + 1),
		});
		if (range.partial) {
			reply.header('Content-Range', `bytes ${range.start}-${range.endInclusive}/${value.sizeBytes}`);
		}
		await deliverArtifactContent(
			reply,
			service.read(
				actor,
				receiptId,
				artifactId,
				{ start: range.start, endInclusive: range.endInclusive },
				signal,
			),
			signal,
		);
	});
	return routes;
}
