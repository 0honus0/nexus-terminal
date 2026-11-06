import { agentHttpSerializer, agentHttpErrorHandler } from './agent-http-response.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { AgentHttpInput } from './agent-input.js';
import { deliverArtifactContent } from './artifact-http-delivery.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	AGENT_ARTIFACT_MAX_BODY_BYTES,
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
import { readAgentId, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import { toArtifactView } from './artifact-mapper.js';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import type { ArtifactService } from '../../artifacts/service/artifact-service.js';
import type { ArtifactActor } from '../../artifacts/model/artifact-types.js';
import { AgentOperationError } from '../../public-errors.js';
import { agentErrorStatus } from './agent-http-status.js';

function send(reply: HttpReply, status: number, value: unknown, mutation = false): void {
	reply
		.type('application/json; charset=utf-8')
		.serializer(
			agentHttpSerializer(AGENT_ARTIFACT_MAX_RESPONSE_BYTES, mutation ? 'operation_unknown' : 'limit_exceeded'),
		)
		.code(status)
		.send(value);
}

function noQuery(request: HttpRequest): void {
	if ([...request.query.keys()].length) {
		throw new InvalidAgentPayload();
	}
}

async function responseIdentity(reply: HttpReply, access: AccessPublicApi, actor: ArtifactActor): Promise<void> {
	if (actor.kind !== 'session') {
		throw new AgentOperationError('forbidden');
	}
	const current = await access.authenticate(actor.token);
	if (!current || current.userId !== actor.userId) {
		throw new AgentOperationError('version_conflict');
	}
	if (reply.raw.destroyed) {
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
		action: (
			request: HttpRequest,
			reply: HttpReply,
			userId: number,
			token: string,
			signal: AbortSignal,
		) => Promise<void>,
		maxBodyBytes = AGENT_ARTIFACT_MAX_BODY_BYTES,
	): void {
		routes.push({
			method,
			url: '/api/v1/agent' + path,
			bodyLimit: maxBodyBytes,
			errorHandler: agentHttpErrorHandler,
			config: { rawBody: method === 'PUT' && path.endsWith('/content') },

			async handler(request, reply) {
				const inputBoundary = new AgentHttpInput(request);
				const abort = new AbortController();

				const closed = () => {
					if (!reply.raw.writableEnded) {
						abort.abort();
					}
				};

				reply.raw.once('close', closed);
				try {
					const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
					const current = await access.authenticate(token);
					if (!current || !token) {
						send(reply, 401, { code: 'unauthenticated' });
						return;
					}
					if (current.userId !== 1) {
						send(reply, 403, { code: 'forbidden' });
						return;
					}
					const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]);
					await boundary(() =>
						inputBoundary.normalize(() => action(request, reply, current.userId, token, signal), signal),
					);
				} catch (error) {
					if (reply.sent || reply.raw.headersSent) {
						reply.raw.destroy(error instanceof Error ? error : undefined);
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
				} finally {
					reply.raw.off('close', closed);
				}
			},
		});
	}

	function addApp(
		method: HttpRoute['method'],
		path: string,
		action: (request: HttpRequest, reply: HttpReply, actor: ArtifactActor, signal: AbortSignal) => Promise<void>,
		maxBodyBytes = AGENT_ARTIFACT_MAX_BODY_BYTES,
	): void {
		add(
			method,
			path,
			(request, reply, userId, token, signal) =>
				action(
					request,
					reply,
					{ kind: 'session', userId, token, appId: readAgentId(request.params.appId) },
					signal,
				),
			maxBodyBytes,
		);
	}

	async function deliver(
		request: HttpRequest,
		reply: HttpReply,
		actor: ArtifactActor,
		status: number,
		value: unknown,
	): Promise<void> {
		try {
			await responseIdentity(reply, access, actor);
			send(reply, status, value, request.method !== 'GET');
		} catch (error) {
			if (request.method !== 'GET') {
				throw new AgentOperationError('operation_unknown');
			}
			throw error;
		}
	}

	async function library(
		request: HttpRequest,
		reply: HttpReply,
		userId: number,
		token: string,
		action: 'list' | 'storage',
	): Promise<void> {
		let result: unknown;
		if (action === 'storage') {
			noQuery(request);
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
			const input = readAgentArtifactQuery(request.query);
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
			send(reply, 401, { code: 'unauthenticated' });
			return;
		}
		send(reply, 200, result);
	}

	add('GET', '/files', (request, reply, userId, token) => library(request, reply, userId, token, 'list'));
	add('GET', '/files/storage', (request, reply, userId, token) => library(request, reply, userId, token, 'storage'));
	addApp('POST', '/apps/:appId/artifacts', async (request, reply, actor) => {
		noQuery(request);
		const input = readAgentArtifactBegin(request.body);
		await deliver(request, reply, actor, 201, {
			artifact: toArtifactView(
				await service.begin(actor, {
					name: input.name,
					mediaType: input.mediaType,
					declaredBytes: input.declaredBytes,
				}),
			),
		});
	});
	addApp('GET', '/apps/:appId/artifacts', async (request, reply, actor) => {
		const query = readAgentArtifactQuery(request.query);
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
		await deliver(request, reply, actor, 200, {
			items: page.items.map(toArtifactView),
			nextOffset: page.nextOffset,
		});
	});
	addApp('GET', '/apps/:appId/artifacts/:artifactId', async (request, reply, actor) => {
		noQuery(request);
		const value = await service.get(actor, readAgentId(request.params.artifactId));
		if (!value) {
			throw new AgentOperationError('not_found');
		}
		await deliver(request, reply, actor, 200, { artifact: toArtifactView(value) });
	});
	addApp('PUT', '/apps/:appId/artifacts/:artifactId/content', async (request, reply, actor, signal) => {
		noQuery(request);
		const artifactId = readAgentId(request.params.artifactId);
		const { expectedVersion } = readAgentArtifactUploadHeaders(
			request.headers['if-match'],
			request.headers['content-type'],
		);

		async function* source(): AsyncIterable<Uint8Array> {
			for await (const chunk of request.raw) {
				signal.throwIfAborted();
				if (!Buffer.isBuffer(chunk)) {
					throw new InvalidAgentPayload();
				}
				yield Uint8Array.from(chunk);
			}
		}

		const value = await service.upload(actor, artifactId, expectedVersion, source(), signal);
		await deliver(request, reply, actor, 200, { artifact: toArtifactView(value) });
	});
	for (const mode of ['content', 'preview'] as const) {
		addApp('GET', '/apps/:appId/artifacts/:artifactId/' + mode, async (request, reply, actor, signal) => {
			noQuery(request);
			const artifactId = readAgentId(request.params.artifactId);
			const value = await service.get(actor, artifactId);
			if (
				!value ||
				value.status !== 'ready' ||
				(!value.retained && value.expiresAt !== null && value.expiresAt <= Date.now())
			) {
				throw new AgentOperationError('not_found');
			}
			if (
				mode === 'preview' &&
				!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(value.mediaType)
			) {
				throw new AgentOperationError('not_found');
			}
			const { start, endInclusive, partial } = readAgentArtifactDownloadRange(
				request.headers.range,
				value.sizeBytes,
			);
			await responseIdentity(reply, access, actor);
			reply.code(partial ? 206 : 200);
			reply.header('Content-Type', mode === 'preview' ? value.mediaType : 'application/octet-stream');
			reply.header('Cache-Control', 'private, no-store');
			reply.header(
				'Content-Disposition',
				(mode === 'preview' ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(value.name),
			);
			reply.header('ETag', '"' + value.version + '"');
			reply.header('Accept-Ranges', 'bytes');
			reply.header('Content-Length', Math.max(0, endInclusive - start + 1));
			if (partial) {
				reply.header('Content-Range', `bytes ${start}-${endInclusive}/${value.sizeBytes}`);
			}
			await deliverArtifactContent(
				reply,
				service.read(actor, artifactId, value.version, { start, endInclusive }, signal),
				signal,
			);
		});
	}
	addApp('PATCH', '/apps/:appId/artifacts/:artifactId/retain', async (request, reply, actor) => {
		noQuery(request);
		const input = readAgentArtifactRetain(request.body);
		await deliver(request, reply, actor, 200, {
			artifact: toArtifactView(
				await service.retain(
					actor,
					readAgentId(request.params.artifactId),
					input.expectedVersion,
					input.retained,
				),
			),
		});
	});
	addApp('DELETE', '/apps/:appId/artifacts/:artifactId', async (request, reply, actor) => {
		noQuery(request);
		const input = readAgentArtifactVersion(request.body);
		await service.delete(actor, readAgentId(request.params.artifactId), input.expectedVersion);
		await deliver(request, reply, actor, 200, { deleted: true });
	});
	addApp('POST', '/apps/:appId/artifacts/:artifactId/attachments', async (request, reply, actor) => {
		noQuery(request);
		const input = readAgentArtifactAttach(request.body);
		const value = await service.attach(actor, readAgentId(request.params.artifactId), {
			expectedVersion: input.expectedVersion,
			targetAppId: input.targetAppId,
			threadId: input.threadId,
			runId: input.runId,
		});
		await deliver(request, reply, actor, 200, {
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
	addApp('DELETE', '/apps/:appId/artifacts/:artifactId/attachments/:threadId', async (request, reply, actor) => {
		noQuery(request);
		const input = readAgentArtifactVersion(request.body);
		await deliver(request, reply, actor, 200, {
			artifact: toArtifactView(
				await service.detach(
					actor,
					readAgentId(request.params.artifactId),
					input.expectedVersion,
					readAgentId(request.params.threadId),
				),
			),
		});
	});
	addApp('POST', '/apps/:appId/artifacts/cleanup/preview', async (request, reply, actor) => {
		noQuery(request);
		readAgentArtifactEmptyRequest(request.body);
		const plan = await service.previewCleanup(actor);
		const byApp = new Map<string, { appId: string; count: number; bytes: number }>();
		for (const item of plan.items) {
			const group = byApp.get(item.appId) ?? { appId: item.appId, count: 0, bytes: 0 };
			group.count++;
			group.bytes += item.sizeBytes;
			byApp.set(item.appId, group);
		}
		await deliver(request, reply, actor, 200, {
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
	addApp('POST', '/apps/:appId/artifacts/cleanup/confirm', async (request, reply, actor) => {
		noQuery(request);
		const input = readAgentArtifactCleanup(request.body);
		const value = await service.confirmCleanup(actor, input.confirmationId);
		await deliver(request, reply, actor, 200, {
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
