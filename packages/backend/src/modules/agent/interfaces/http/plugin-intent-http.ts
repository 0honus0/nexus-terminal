import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	readAgentId,
	agentRecord,
	encodeAgentJson,
	InvalidAgentPayload,
} from '@nexus-terminal/shared/agent/http-codec';
import {
	readAgentPluginIntentCreate,
	readAgentPluginIntentQuery,
} from '@nexus-terminal/shared/agent/plugins/intent-http-codec';
import {
	AGENT_PLUGIN_INTENT_MAX_BODY_BYTES,
	AGENT_PLUGIN_INTENT_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/plugins/intent-values';
import { readAgentArtifactDownloadRange } from '@nexus-terminal/shared/agent/artifacts/http-codec';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
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

	function send(ctx: HttpRouteContext, status: number, value: unknown): void {
		try {
			encodeAgentJson(value, AGENT_PLUGIN_INTENT_MAX_RESPONSE_BYTES);
		} catch (error) {
			throw new AgentFailure(ctx.method === 'GET' ? 'limit_exceeded' : 'operation_unknown', { cause: error });
		}
		ctx.send(status, value);
	}

	function add(
		method: HttpRoute['method'],
		suffix: string,
		action: (
			ctx: HttpRouteContext,
			actor: PluginIntentSessionActor,
			signal: AbortSignal,
			input: AgentHttpInput,
		) => Promise<void>,
	): void {
		routes.push({
			method,
			path: '/api/v1/agent/apps/:appId/plugin-intents' + suffix,
			maxBodyBytes: AGENT_PLUGIN_INTENT_MAX_BODY_BYTES,

			async handle(ctx) {
				const input = new AgentHttpInput(ctx),
					aborted = new AbortController();

				const closed = () => {
					if (!ctx.response.writableEnded) {
						aborted.abort();
					}
				};

				ctx.response.once('close', closed);
				try {
					if (suffix !== '' || method !== 'GET') {
						if ([...ctx.query.keys()].length) {
							throw new InvalidAgentPayload();
						}
					}
					const token = ctx.cookie(ACCESS_SESSION_COOKIE_NAME),
						identity = await access.authenticate(token);
					if (!token || !identity) {
						send(ctx, 401, { code: 'unauthenticated' });
						return;
					}
					if (identity.userId !== 1) {
						send(ctx, 403, { code: 'forbidden' });
						return;
					}
					const actor: PluginIntentSessionActor = {
						userId: identity.userId,
						appId: readAgentId(ctx.params.appId),
						token,
						authorization: { kind: 'session' },
					};
					const signal = AbortSignal.any([aborted.signal, AbortSignal.timeout(60000)]);
					await boundary(() => input.normalize(() => action(ctx, actor, signal, input), signal));
				} catch (error) {
					if (ctx.response.headersSent || ctx.response.destroyed || ctx.response.writableEnded) {
						ctx.response.destroy();
						return;
					}
					if (input.transportFailure) {
						throw input.transportFailure;
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
				} finally {
					ctx.response.off('close', closed);
				}
			},
		});
	}

	async function confirm(
		ctx: HttpRouteContext,
		actor: PluginIntentSessionActor,
		signal?: AbortSignal,
	): Promise<void> {
		try {
			if (
				(await access.authenticate(actor.token))?.userId !== actor.userId ||
				ctx.response.destroyed ||
				signal?.aborted
			) {
				throw new AgentFailure(ctx.method === 'GET' ? 'unauthenticated' : 'operation_unknown');
			}
		} catch (error) {
			if (error instanceof AgentFailure) {
				throw error;
			}
			const code =
				error instanceof AccessOperationError && error.code === 'storage_unavailable'
					? 'storage_unavailable'
					: 'internal_failure';
			throw new AgentFailure(ctx.method === 'GET' ? code : 'operation_unknown', { cause: error });
		}
	}

	add('POST', '', async (ctx, actor, signal, input) => {
		const request = await input.read(readAgentPluginIntentCreate, signal);
		signal.throwIfAborted();
		const value = await service.create(actor, toPluginIntentInput(request), signal);
		await confirm(ctx, actor, signal);
		send(ctx, 201, { receipt: toPluginIntent(value) });
	});
	add('GET', '', async (ctx, actor) => {
		const items = await service.list(actor, readAgentPluginIntentQuery(ctx.query).limit);
		await confirm(ctx, actor);
		send(ctx, 200, { items: items.map(toPluginIntent) });
	});
	add('DELETE', '/:receiptId', async (ctx, actor, signal, input) => {
		await input.read((value) => agentRecord(value, []), signal);
		signal.throwIfAborted();
		await service.revoke(actor, readAgentId(ctx.params.receiptId), signal);
		await confirm(ctx, actor, signal);
		send(ctx, 200, { revoked: true });
	});
	add('GET', '/:receiptId/artifacts/:artifactId', async (ctx, actor) => {
		const value = await service.artifact(
			actor,
			readAgentId(ctx.params.receiptId),
			readAgentId(ctx.params.artifactId),
		);
		await confirm(ctx, actor);
		send(ctx, 200, { artifact: toArtifactView(value) });
	});
	add('GET', '/:receiptId/artifacts/:artifactId/content', async (ctx, actor, signal) => {
		const receiptId = readAgentId(ctx.params.receiptId),
			artifactId = readAgentId(ctx.params.artifactId);
		const value = await service.artifact(actor, receiptId, artifactId);
		const range = readAgentArtifactDownloadRange(ctx.request.headers.range, value.sizeBytes);
		await confirm(ctx, actor);
		ctx.response.statusCode = range.partial ? 206 : 200;
		ctx.response.setHeader('Content-Type', 'application/octet-stream');
		ctx.response.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(value.name));
		ctx.response.setHeader('Cache-Control', 'no-store');
		ctx.response.setHeader('Accept-Ranges', 'bytes');
		ctx.response.setHeader('ETag', '"' + value.version + '"');
		ctx.response.setHeader('Content-Length', Math.max(0, range.endInclusive - range.start + 1));
		if (range.partial) {
			ctx.response.setHeader('Content-Range', `bytes ${range.start}-${range.endInclusive}/${value.sizeBytes}`);
		}
		await pipeline(
			Readable.from(
				service.read(
					actor,
					receiptId,
					artifactId,
					{ start: range.start, endInclusive: range.endInclusive },
					signal,
				),
			),
			ctx.response,
			{ signal },
		);
	});
	return routes;
}
