import { AgentHttpInput } from './agent-input.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	AGENT_ARTIFACT_MAX_BODY_BYTES,
	AGENT_ARTIFACT_MAX_BYTES,
	AGENT_ARTIFACT_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/artifacts/values';
import {
	readAgentArtifactBegin,
	readAgentArtifactUploadHeaders,
	readAgentArtifactDownloadRange,
	readAgentArtifactEmptyRequest,
	readAgentArtifactRetain,
	readAgentArtifactVersion,
	readAgentArtifactAttach,
	readAgentArtifactCleanup,
	readAgentArtifactQuery,
} from '@nexus-terminal/shared/agent/artifacts/http-codec';
import { readAgentId, encodeAgentJson, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import { toArtifactView } from './artifact-mapper.js';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import type { ArtifactService } from '../../artifacts/service/artifact-service.js';
import type { ArtifactActor } from '../../artifacts/model/artifact-types.js';
import { AgentOperationError } from '../../public-errors.js';
import { agentErrorStatus } from './agent-http-status.js';

function send(ctx: HttpRouteContext, status: number, value: unknown): void {
	try {
		encodeAgentJson(value, AGENT_ARTIFACT_MAX_RESPONSE_BYTES);
	} catch {
		throw new AgentOperationError('limit_exceeded');
	}
	ctx.send(status, value);
}

function noQuery(ctx: HttpRouteContext): void {
	if ([...ctx.query.keys()].length) {
		throw new InvalidAgentPayload();
	}
}

async function responseIdentity(ctx: HttpRouteContext, access: AccessPublicApi, actor: ArtifactActor): Promise<void> {
	if (actor.kind !== 'session') {
		throw new AgentOperationError('forbidden');
	}
	const current = await access.authenticate(actor.token);
	if (!current || current.userId !== actor.userId) {
		throw new AgentOperationError('version_conflict');
	}
	if (ctx.response.destroyed) {
		throw new AgentOperationError('operation_unknown');
	}
}

export function createArtifactHttpRoutes(
	access: AccessPublicApi,
	service: ArtifactService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute[] {
	const routes: HttpRoute[] = [];

	function add(
		method: HttpRoute['method'],
		path: string,
		action: (ctx: HttpRouteContext, userId: number, token: string, signal: AbortSignal) => Promise<void>,
		maxBodyBytes = AGENT_ARTIFACT_MAX_BODY_BYTES,
	): void {
		routes.push({
			method,
			path: '/api/v1/agent' + path,
			maxBodyBytes,

			async handle(ctx) {
				const inputBoundary = new AgentHttpInput(ctx);
				const abort = new AbortController();

				const closed = () => {
					if (!ctx.response.writableEnded) {
						abort.abort();
					}
				};

				ctx.response.once('close', closed);
				try {
					const token = ctx.cookie(ACCESS_SESSION_COOKIE_NAME);
					const current = await access.authenticate(token);
					if (!current || !token) {
						send(ctx, 401, { code: 'unauthenticated' });
						return;
					}
					if (current.userId !== 1) {
						send(ctx, 403, { code: 'forbidden' });
						return;
					}
					const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]);
					await boundary(() =>
						inputBoundary.normalize(() => action(ctx, current.userId, token, signal), signal),
					);
				} catch (error) {
					if (inputBoundary.transportFailure) {
						throw inputBoundary.transportFailure;
					}
					if (ctx.response.headersSent) {
						ctx.response.destroy(error instanceof Error ? error : undefined);
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
				} finally {
					ctx.response.off('close', closed);
				}
			},
		});
	}

	function addApp(
		method: HttpRoute['method'],
		path: string,
		action: (ctx: HttpRouteContext, actor: ArtifactActor, signal: AbortSignal) => Promise<void>,
		maxBodyBytes = AGENT_ARTIFACT_MAX_BODY_BYTES,
	): void {
		add(
			method,
			path,
			(ctx, userId, token, signal) =>
				action(ctx, { kind: 'session', userId, token, appId: readAgentId(ctx.params.appId) }, signal),
			maxBodyBytes,
		);
	}

	async function deliver(ctx: HttpRouteContext, actor: ArtifactActor, status: number, value: unknown): Promise<void> {
		try {
			await responseIdentity(ctx, access, actor);
			send(ctx, status, value);
		} catch (error) {
			if (ctx.method !== 'GET') {
				throw new AgentOperationError('operation_unknown');
			}
			throw error;
		}
	}

	async function library(
		ctx: HttpRouteContext,
		userId: number,
		token: string,
		action: 'list' | 'storage',
	): Promise<void> {
		let result: unknown;
		if (action === 'storage') {
			noQuery(ctx);
			const value = await service.summary(userId);
			result = {
				storage: {
					totalBytes: value.totalBytes,
					retainedBytes: value.retainedBytes,
					protectedBytes: value.protectedBytes,
					reclaimableBytes: value.reclaimableBytes,
					stagingBytes: value.stagingBytes,
					unavailableBytes: value.unavailableBytes,
					reservedBytes: value.reservedBytes,
					limitBytes: value.limitBytes,
				},
			};
		} else {
			const input = readAgentArtifactQuery(ctx.query);
			const page = await service.list(userId, {
				appId: input.appId,
				retained: input.retained,
				kind: input.kind,
				q: input.q,
				offset: input.offset,
				limit: input.limit,
			});
			result = { items: page.items.map(toArtifactView), nextOffset: page.nextOffset };
		}
		const current = await access.authenticate(token);
		if (!current || current.userId !== userId) {
			send(ctx, 401, { code: 'unauthenticated' });
			return;
		}
		send(ctx, 200, result);
	}

	add('GET', '/files', (ctx, userId, token) => library(ctx, userId, token, 'list'));
	add('GET', '/files/storage', (ctx, userId, token) => library(ctx, userId, token, 'storage'));
	addApp('POST', '/apps/:appId/artifacts', async (ctx, actor) => {
		noQuery(ctx);
		const input = readAgentArtifactBegin(await ctx.json());
		await deliver(ctx, actor, 201, {
			artifact: toArtifactView(
				await service.begin(actor, {
					name: input.name,
					mediaType: input.mediaType,
					declaredBytes: input.declaredBytes,
				}),
			),
		});
	});
	addApp('GET', '/apps/:appId/artifacts', async (ctx, actor) => {
		const query = readAgentArtifactQuery(ctx.query);
		if (query.appId !== null && query.appId !== actor.appId) {
			throw new InvalidAgentPayload();
		}
		const page = await service.list(actor.userId, {
			appId: actor.appId,
			retained: query.retained,
			kind: query.kind,
			q: query.q,
			offset: query.offset,
			limit: query.limit,
		});
		await deliver(ctx, actor, 200, { items: page.items.map(toArtifactView), nextOffset: page.nextOffset });
	});
	addApp('GET', '/apps/:appId/artifacts/:artifactId', async (ctx, actor) => {
		noQuery(ctx);
		const value = await service.get(actor, readAgentId(ctx.params.artifactId));
		if (!value) {
			throw new AgentOperationError('not_found');
		}
		await deliver(ctx, actor, 200, { artifact: toArtifactView(value) });
	});
	addApp(
		'PUT',
		'/apps/:appId/artifacts/:artifactId/content',
		async (ctx, actor, signal) => {
			noQuery(ctx);
			const artifactId = readAgentId(ctx.params.artifactId);
			const { expectedVersion } = readAgentArtifactUploadHeaders(
				ctx.request.headers['if-match'],
				ctx.request.headers['content-type'],
			);

			async function* source(): AsyncIterable<Uint8Array> {
				for await (const chunk of ctx.request) {
					signal.throwIfAborted();
					if (!Buffer.isBuffer(chunk)) {
						throw new InvalidAgentPayload();
					}
					yield Uint8Array.from(chunk);
				}
			}

			const value = await service.upload(actor, artifactId, expectedVersion, source(), signal);
			await deliver(ctx, actor, 200, { artifact: toArtifactView(value) });
		},
		AGENT_ARTIFACT_MAX_BYTES,
	);
	for (const mode of ['content', 'preview'] as const) {
		addApp('GET', '/apps/:appId/artifacts/:artifactId/' + mode, async (ctx, actor, signal) => {
			noQuery(ctx);
			const artifactId = readAgentId(ctx.params.artifactId);
			const value = await service.get(actor, artifactId);
			if (
				!value ||
				value.status !== 'ready' ||
				(!value.retained && value.expiresAt !== null && value.expiresAt <= Date.now())
			) {
				throw new AgentOperationError('not_found');
			}
			if (mode === 'preview' && !['image/png', 'image/jpeg', 'image/webp'].includes(value.mediaType)) {
				throw new AgentOperationError('not_found');
			}
			const { start, endInclusive, partial } = readAgentArtifactDownloadRange(
				ctx.request.headers.range,
				value.sizeBytes,
			);
			await responseIdentity(ctx, access, actor);
			ctx.response.statusCode = partial ? 206 : 200;
			ctx.response.setHeader('Content-Type', mode === 'preview' ? value.mediaType : 'application/octet-stream');
			ctx.response.setHeader('X-Content-Type-Options', 'nosniff');
			ctx.response.setHeader('Cache-Control', 'private, no-store');
			ctx.response.setHeader(
				'Content-Disposition',
				(mode === 'preview' ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(value.name),
			);
			ctx.response.setHeader('ETag', '"' + value.version + '"');
			ctx.response.setHeader('Accept-Ranges', 'bytes');
			ctx.response.setHeader('Content-Length', Math.max(0, endInclusive - start + 1));
			if (partial) {
				ctx.response.setHeader('Content-Range', `bytes ${start}-${endInclusive}/${value.sizeBytes}`);
			}
			await pipeline(
				Readable.from(service.read(actor, artifactId, value.version, { start, endInclusive }, signal)),
				ctx.response,
				{
					signal,
				},
			);
		});
	}
	addApp('PATCH', '/apps/:appId/artifacts/:artifactId/retain', async (ctx, actor) => {
		noQuery(ctx);
		const input = readAgentArtifactRetain(await ctx.json());
		await deliver(ctx, actor, 200, {
			artifact: toArtifactView(
				await service.retain(actor, readAgentId(ctx.params.artifactId), input.expectedVersion, input.retained),
			),
		});
	});
	addApp('DELETE', '/apps/:appId/artifacts/:artifactId', async (ctx, actor) => {
		noQuery(ctx);
		const input = readAgentArtifactVersion(await ctx.json());
		await service.delete(actor, readAgentId(ctx.params.artifactId), input.expectedVersion);
		await deliver(ctx, actor, 200, { deleted: true });
	});
	addApp('POST', '/apps/:appId/artifacts/:artifactId/attachments', async (ctx, actor) => {
		noQuery(ctx);
		const input = readAgentArtifactAttach(await ctx.json());
		const value = await service.attach(actor, readAgentId(ctx.params.artifactId), {
			expectedVersion: input.expectedVersion,
			targetAppId: input.targetAppId,
			threadId: input.threadId,
			runId: input.runId,
		});
		await deliver(ctx, actor, 200, {
			attachment: {
				artifact: toArtifactView(value),
				sourceAppId: value.appId,
				targetAppId: input.targetAppId,
				threadId: input.threadId,
				runId: input.runId,
				role: 'input',
				crossApp: value.appId !== input.targetAppId,
			},
		});
	});
	addApp('DELETE', '/apps/:appId/artifacts/:artifactId/attachments/:threadId', async (ctx, actor) => {
		noQuery(ctx);
		const input = readAgentArtifactVersion(await ctx.json());
		await deliver(ctx, actor, 200, {
			artifact: toArtifactView(
				await service.detach(
					actor,
					readAgentId(ctx.params.artifactId),
					input.expectedVersion,
					readAgentId(ctx.params.threadId),
				),
			),
		});
	});
	addApp('POST', '/apps/:appId/artifacts/cleanup/preview', async (ctx, actor) => {
		noQuery(ctx);
		readAgentArtifactEmptyRequest(await ctx.json());
		const plan = await service.previewCleanup(actor);
		const byApp = new Map<string, { appId: string; count: number; bytes: number }>();
		for (const item of plan.items) {
			const group = byApp.get(item.appId) ?? { appId: item.appId, count: 0, bytes: 0 };
			group.count++;
			group.bytes += item.sizeBytes;
			byApp.set(item.appId, group);
		}
		await deliver(ctx, actor, 200, {
			confirmation: {
				confirmationId: plan.id,
				expiresAt: plan.expiresAt,
				selectedCount: plan.items.length,
				selectedBytes: plan.items.reduce((sum, item) => sum + item.sizeBytes, 0),
				protectedCount: plan.protectedCount,
				byApp: [...byApp.values()],
			},
		});
	});
	addApp('POST', '/apps/:appId/artifacts/cleanup/confirm', async (ctx, actor) => {
		noQuery(ctx);
		const input = readAgentArtifactCleanup(await ctx.json());
		const value = await service.confirmCleanup(actor, input.confirmationId);
		await deliver(ctx, actor, 200, {
			result: {
				deletedCount: value.deletedCount,
				deletedBytes: value.deletedBytes,
				skippedCount: value.skippedCount,
				failedCount: value.failedCount,
				partial: value.partial,
			},
		});
	});
	return routes;
}
