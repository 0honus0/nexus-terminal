import { readAgentPluginRuntimeAcknowledgement } from '@nexus-terminal/shared/agent/plugins/runtime-http-codec';
import { readAgentPluginDataMigration } from '@nexus-terminal/shared/agent/plugins/migration-http-codec';
import { AGENT_PLUGIN_MAX_MIGRATION_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import {
	fromPluginDataMigration,
	toPluginDataSnapshot,
	toPluginDataMigrationResult,
} from './plugin-migration-mapper.js';
import { toPluginRuntimeObservation } from './plugin-mapper.js';
import type { PluginRepositoryService } from '../../plugins/service/plugin-repository-service.js';
import { OFFICIAL_PLUGIN_SOURCE } from '../../plugins/service/plugin-source.js';
import {
	readAgentPluginRepositoryUrl,
	readAgentPluginRepositoryUpdate,
	readAgentPluginRepositoryStage,
	readAgentPluginOfficialStage,
} from '@nexus-terminal/shared/agent/plugins/repository-http-codec';
import { AGENT_PLUGIN_MAX_CATALOG_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import { agentRecord } from '@nexus-terminal/shared/agent/http-codec';
import { toPluginCatalog, toPluginRepositorySettings, toPluginRecommended } from './plugin-mapper.js';
import { AgentFailure } from '../../agent-failure.js';
import { AgentHttpInput } from './agent-input.js';
import { createPluginRpcHttpRoute } from './plugin-rpc-http.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { readAgentId, InvalidAgentPayload, encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import {
	readAgentPluginDataPurge,
	readAgentPluginDataKey,
	readAgentPluginDataWrite,
	readAgentPluginDataDelete,
	readAgentPluginPublisher,
	readAgentPluginStage,
	readAgentPluginVersion,
	readAgentPluginInstall,
	readAgentPluginRetirement,
	readAgentPluginUpgrade,
} from '@nexus-terminal/shared/agent/plugins/http-codec';
import {
	AGENT_PLUGIN_MAX_MESSAGE_BYTES,
	AGENT_PLUGIN_MAX_BODY_BYTES,
	AGENT_PLUGIN_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/plugins/values';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { AgentOperationError } from '../../public-errors.js';
import type { PluginService } from '../../plugins/service/plugin-service.js';
import type { PluginActor } from '../../plugins/model/plugin-types.js';
import { agentErrorStatus } from './agent-http-status.js';
import {
	toPluginDataPurge,
	toPluginData,
	toPluginPublisher,
	toPluginStage,
	toPluginInstallation,
	toPluginVersion,
	toPluginDescriptor,
} from './plugin-mapper.js';

export function createPluginHttpRoutes(
	access: AccessPublicApi,
	service: PluginService,
	repositories: PluginRepositoryService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute[] {
	const routes: HttpRoute[] = [];

	function add(
		method: HttpRoute['method'],
		path: string,
		action: (ctx: HttpRouteContext, actor: PluginActor, input: AgentHttpInput) => Promise<unknown>,
		maxBodyBytes = AGENT_PLUGIN_MAX_BODY_BYTES,
		maxResponseBytes = AGENT_PLUGIN_MAX_RESPONSE_BYTES,
	): void {
		routes.push({
			method,
			path: (path.startsWith('/onboarding/') ? '/api/v1/agent' : '/api/v1/agent/plugins') + path,
			maxBodyBytes,
			maxPathParameterBytes: 128,
			pathParameterAlphabet: 'opaque',

			async handle(ctx) {
				const input = new AgentHttpInput(ctx);
				let completed = false;
				try {
					const queryKeys = path === '/remote/catalog' ? ['repositoryUrl'] : [];
					if (
						[...ctx.query.keys()].some(
							(key) => !queryKeys.includes(key) || ctx.query.getAll(key).length !== 1,
						)
					) {
						throw new InvalidAgentPayload();
					}
					const token = ctx.cookie(ACCESS_SESSION_COOKIE_NAME),
						identity = await access.authenticate(token);
					if (!token || !identity) {
						ctx.send(401, { code: 'unauthenticated' });
						return;
					}
					if (identity.userId !== 1) {
						ctx.send(403, { code: 'forbidden' });
						return;
					}
					const actor = { userId: identity.userId, token };
					const result = await boundary(() => input.normalize(() => action(ctx, actor, input)));
					completed = method !== 'GET';
					if ((await access.authenticate(token))?.userId !== actor.userId) {
						ctx.send(completed ? 503 : 401, { code: completed ? 'operation_unknown' : 'unauthenticated' });
						return;
					}
					try {
						encodeAgentJson(result, maxResponseBytes);
					} catch {
						throw new AgentOperationError('limit_exceeded');
					}
					ctx.send(200, result);
				} catch (error) {
					if (ctx.response.headersSent || ctx.response.destroyed || ctx.response.writableEnded) {
						ctx.response.destroy();
						return;
					}
					if (input.transportFailure) {
						throw input.transportFailure;
					}
					if (completed) {
						ctx.send(503, { code: 'operation_unknown' });
						return;
					}
					if (error instanceof HttpInputFailure) {
						throw error;
					}
					if (error instanceof InvalidAgentPayload) {
						ctx.send(400, { code: 'invalid_input' });
					} else if (error instanceof AgentOperationError) {
						ctx.send(agentErrorStatus(error.code), { code: error.code });
					} else if (error instanceof AccessOperationError) {
						ctx.send(error.code === 'storage_unavailable' ? 503 : 500, {
							code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
						});
					} else {
						ctx.send(500, { code: 'internal_failure' });
					}
				}
			},
		});
	}

	add(
		'GET',
		'/installations/:appId/data-snapshot',
		async (ctx, actor) => toPluginDataSnapshot(await service.dataSnapshot(actor, readAgentId(ctx.params.appId))),
		AGENT_PLUGIN_MAX_BODY_BYTES,
		AGENT_PLUGIN_MAX_MIGRATION_BYTES,
	);
	add(
		'POST',
		'/installations/:appId/migrate-data',
		async (ctx, actor, reader) =>
			toPluginDataMigrationResult(
				await service.migrateData(actor, readAgentId(ctx.params.appId), async (signal) =>
					fromPluginDataMigration(await reader.read(readAgentPluginDataMigration, signal)),
				),
			),
		AGENT_PLUGIN_MAX_MIGRATION_BYTES,
	);
	add('POST', '/installations/:appId/prepare-upgrade', async (ctx, actor, reader) => {
		const input = await reader.read(readAgentPluginUpgrade);
		return toPluginInstallation(
			await service.prepareUpgrade(
				actor,
				readAgentId(ctx.params.appId),
				input.expectedRevision,
				input.stageId,
				input.expectedStageVersion,
			),
		);
	});
	add('POST', '/installations/:appId/delete-data', async (ctx, actor, reader) => {
		const input = await reader.read(readAgentPluginDataPurge);
		return toPluginDataPurge(
			await service.purgeData(actor, readAgentId(ctx.params.appId), input.expectedRevision, input.operationId),
		);
	});
	routes.push(createPluginRpcHttpRoute(access, service, boundary));
	add('GET', '/installations/:appId/data/:key', async (ctx, actor) => {
		const value = await service.readData(
			actor,
			readAgentId(ctx.params.appId),
			readAgentPluginDataKey(ctx.params.key),
		);
		return { value: value === null ? null : toPluginData(value) };
	});
	add(
		'PUT',
		'/installations/:appId/data/:key',
		async (ctx, actor, reader) => {
			const key = readAgentPluginDataKey(ctx.params.key);
			return toPluginData(
				await service.mutateData(actor, readAgentId(ctx.params.appId), async (signal) => {
					const input = await reader.read(readAgentPluginDataWrite, signal);
					return {
						key,
						expectedRevision: input.expectedRevision,
						expectedVersion: input.expectedVersion,
						operationId: input.operationId,
						valueJson: input.valueJson,
					};
				}),
			);
		},
		AGENT_PLUGIN_MAX_MESSAGE_BYTES,
	);
	add('DELETE', '/installations/:appId/data/:key', async (ctx, actor, reader) => {
		const key = readAgentPluginDataKey(ctx.params.key);
		return toPluginData(
			await service.mutateData(actor, readAgentId(ctx.params.appId), async (signal) => {
				const input = await reader.read(readAgentPluginDataDelete, signal);
				return {
					key,
					expectedRevision: input.expectedRevision,
					expectedVersion: input.expectedVersion,
					operationId: input.operationId,
					valueJson: null,
				};
			}),
		);
	});

	add('GET', '/repositories', async (_ctx, actor) => toPluginRepositorySettings(await repositories.get(actor)));
	add('PUT', '/repositories', async (_ctx, actor, reader) =>
		toPluginRepositorySettings(
			await repositories.put(actor, async (signal) => {
				const input = await reader.read(readAgentPluginRepositoryUpdate, signal);
				return {
					version: input.expectedVersion,
					repositories: input.repositories.map((item) => ({ url: item.url })),
				};
			}),
		),
	);
	add(
		'GET',
		'/official/catalog',
		async (_ctx, actor) => toPluginCatalog(await repositories.catalog(actor, OFFICIAL_PLUGIN_SOURCE.catalogUrl)),
		AGENT_PLUGIN_MAX_BODY_BYTES,
		AGENT_PLUGIN_MAX_CATALOG_BYTES,
	);
	add(
		'GET',
		'/remote/catalog',
		async (ctx, actor) =>
			toPluginCatalog(
				await repositories.catalog(actor, readAgentPluginRepositoryUrl(ctx.query.get('repositoryUrl'))),
			),
		AGENT_PLUGIN_MAX_BODY_BYTES,
		AGENT_PLUGIN_MAX_CATALOG_BYTES,
	);
	add('POST', '/official/stage', async (_ctx, actor, reader) =>
		toPluginStage(
			await repositories.stage(actor, async (signal) => {
				const input = await reader.read(readAgentPluginOfficialStage, signal);
				return { repositoryUrl: OFFICIAL_PLUGIN_SOURCE.catalogUrl, appId: input.appId, version: input.version };
			}),
		),
	);
	add('POST', '/remote/stage', async (_ctx, actor, reader) =>
		toPluginStage(
			await repositories.stage(actor, async (signal) => {
				const input = await reader.read(readAgentPluginRepositoryStage, signal);
				return { repositoryUrl: input.repositoryUrl, appId: input.appId, version: input.version };
			}),
		),
	);
	add('GET', '/onboarding/recommended-plugin', async (_ctx, actor) =>
		toPluginRecommended(await repositories.recommended(actor)),
	);
	add('POST', '/onboarding/recommended-plugin/install', async (_ctx, actor, reader) =>
		toPluginInstallation(
			await repositories.installRecommended(actor, async (signal) => {
				await reader.read((raw) => {
					agentRecord(raw, []);
				}, signal);
			}),
		),
	);

	add('GET', '/versions', async (_ctx, actor) => ({ items: (await service.versions(actor)).map(toPluginVersion) }));
	add('GET', '/installations/:appId/descriptor', async (ctx, actor) =>
		toPluginDescriptor(await service.descriptor(actor, readAgentId(ctx.params.appId))),
	);
	add('POST', '/installations/:appId/upgrade', async (ctx, actor, reader) => {
		const input = await reader.read(readAgentPluginUpgrade);
		return toPluginInstallation(
			await service.upgrade(
				actor,
				readAgentId(ctx.params.appId),
				input.expectedRevision,
				input.stageId,
				input.expectedStageVersion,
			),
		);
	});
	add('DELETE', '/installations/:appId', async (ctx, actor, reader) => {
		const input = await reader.read(readAgentPluginRetirement);
		return toPluginInstallation(await service.remove(actor, readAgentId(ctx.params.appId), input.expectedRevision));
	});
	add('POST', '/installations/:appId/cancel-retirement', async (ctx, actor, reader) => {
		const input = await reader.read(readAgentPluginRetirement);
		return toPluginInstallation(
			await service.cancelRetirement(actor, readAgentId(ctx.params.appId), input.expectedRevision),
		);
	});
	add('GET', '/installations', async (_ctx, actor) => ({
		items: (await service.installations(actor)).map(toPluginInstallation),
	}));
	add('POST', '/install', async (ctx, actor, reader) => {
		const input = await reader.read(readAgentPluginInstall);
		return toPluginInstallation(await service.install(actor, input.stageId, input.expectedVersion));
	});
	add('GET', '/stages', async (_ctx, actor) => ({ items: (await service.stages(actor)).map(toPluginStage) }));
	add('GET', '/installations/:appId/runtime', async (ctx, actor) => {
		const value = await service.runtimeObservation(actor, readAgentId(ctx.params.appId));
		return value === null ? null : toPluginRuntimeObservation(value);
	});
	add('GET', '/installations/:appId/runtime/:instanceId', async (ctx, actor) => {
		const value = await service.runtimeObservation(
			actor,
			readAgentId(ctx.params.appId),
			readAgentId(ctx.params.instanceId),
		);
		return value === null ? null : toPluginRuntimeObservation(value);
	});
	add('POST', '/installations/:appId/runtime/acknowledge', async (ctx, actor, input) => {
		const command = await input.read(readAgentPluginRuntimeAcknowledgement);
		return toPluginRuntimeObservation(
			await service.acknowledgeRuntime(actor, readAgentId(ctx.params.appId), {
				expectedRevision: command.expectedRevision,
				instanceRevision: command.instanceRevision,
				instanceId: command.instanceId,
				confirmed: command.confirmed,
			}),
		);
	});
	add('GET', '/publishers', async (_ctx, actor) => ({
		items: (await service.publishers(actor)).map(toPluginPublisher),
	}));
	add('POST', '/publishers', async (ctx, actor, reader) => {
		const input = await reader.read(readAgentPluginPublisher);
		return toPluginPublisher(await service.putPublisher(actor, input.label, input.publicKeyPem));
	});
	add('DELETE', '/publishers/:keyId', async (ctx, actor, reader) => {
		const keyId = ctx.params.keyId;
		if (!keyId || !/^ed25519:[a-f0-9]{64}$/u.test(keyId)) {
			throw new InvalidAgentPayload();
		}
		return toPluginPublisher(
			await service.revokePublisher(actor, keyId, await reader.read(readAgentPluginVersion)),
		);
	});
	add('POST', '/stage', async (ctx, actor, reader) => {
		const input = await reader.read(readAgentPluginStage);
		return toPluginStage(
			await service.stage(actor, {
				artifactAppId: input.artifactAppId,
				artifactId: input.artifactId,
				expectedVersion: input.expectedVersion,
			}),
		);
	});
	add('GET', '/stages/:stageId', async (ctx, actor) =>
		toPluginStage(await service.getStage(actor, readAgentId(ctx.params.stageId))),
	);
	add('POST', '/verify', async (ctx, actor, reader) => {
		const input = await reader.read(readAgentPluginInstall);
		return toPluginStage(await service.verify(actor, input.stageId, input.expectedVersion));
	});
	return routes;
}

export function createPluginContentRoutes(
	service: PluginService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute[] {
	const sdk = (path: string, resolve: (ctx: HttpRouteContext) => string): HttpRoute => ({
		method: 'GET',
		path,
		maxPathParameterBytes: 2048,
		pathParameterAlphabet: 'opaque',

		async handle(ctx) {
			try {
				if ([...ctx.query.keys()].length) {
					throw new InvalidAgentPayload();
				}
				await boundary(() =>
					service.sdkAsset(resolve(ctx), async (content, signal) => {
						ctx.response.writeHead(200, {
							'Content-Type': 'text/javascript; charset=utf-8',
							'Content-Length': String(content.bytes.byteLength),
							'Cache-Control': 'no-store',
							'X-Content-Type-Options': 'nosniff',
							'Access-Control-Allow-Origin': '*',
							'Cross-Origin-Resource-Policy': 'cross-origin',
						});
						await deliverContent(ctx, content.bytes, signal);
					}),
				);
			} catch (error) {
				if (ctx.response.headersSent) {
					ctx.response.destroy();
					return;
				}
				if (error instanceof InvalidAgentPayload) {
					ctx.send(400, { code: 'invalid_input' });
				} else if (error instanceof AgentOperationError) {
					ctx.send(agentErrorStatus(error.code), { code: error.code });
				} else {
					ctx.send(500, { code: 'internal_failure' });
				}
			}
		},
	});

	return [
		sdk('/sdk/frontend-v1.mjs', () => 'frontend-v1.mjs'),
		sdk('/sdk/agent/*modulePath', (ctx) => 'agent/' + ctx.params.modulePath),
		{
			method: 'GET',
			path: '/plugins/:appId/:version/:grant/*assetPath',
			maxPathParameterBytes: 2048,
			pathParameterAlphabet: 'opaque',

			async handle(ctx) {
				try {
					if ([...ctx.query.keys()].length) {
						throw new InvalidAgentPayload();
					}
					const appId = readAgentId(ctx.params.appId),
						grant = readAgentId(ctx.params.grant),
						version = ctx.params.version,
						path = ctx.params.assetPath;
					if (!version || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/u.test(version) || !path) {
						throw new InvalidAgentPayload();
					}
					await boundary(() =>
						service.asset(appId, version, grant, path, async (content, signal) => {
							const types: Readonly<Record<string, string>> = {
								html: 'text/html; charset=utf-8',
								css: 'text/css; charset=utf-8',
								js: 'text/javascript; charset=utf-8',
								mjs: 'text/javascript; charset=utf-8',
								json: 'application/json',
								png: 'image/png',
								jpg: 'image/jpeg',
								jpeg: 'image/jpeg',
								gif: 'image/gif',
								svg: 'image/svg+xml',
								webp: 'image/webp',
								woff: 'font/woff',
								woff2: 'font/woff2',
								ttf: 'font/ttf',
								wasm: 'application/wasm',
								txt: 'text/plain; charset=utf-8',
							};
							ctx.response.writeHead(200, {
								'Content-Type': types[path.split('.').at(-1) ?? ''] ?? 'application/octet-stream',
								'Content-Length': String(content.bytes.byteLength),
								'Cache-Control': 'no-store',
								'X-Content-Type-Options': 'nosniff',
								'Referrer-Policy': 'no-referrer',
								'Access-Control-Allow-Origin': '*',
								'Cross-Origin-Resource-Policy': 'cross-origin',
								'Content-Security-Policy':
									"sandbox allow-scripts; default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
								ETag: '"' + content.sha256 + '"',
							});
							await deliverContent(ctx, content.bytes, signal);
						}),
					);
				} catch (error) {
					if (ctx.response.headersSent) {
						ctx.response.destroy();
						return;
					}
					if (error instanceof InvalidAgentPayload) {
						ctx.send(400, { code: 'invalid_input' });
					} else if (error instanceof AgentOperationError) {
						ctx.send(agentErrorStatus(error.code), { code: error.code });
					} else {
						ctx.send(500, { code: 'internal_failure' });
					}
				}
			},
		},
	];
}

async function deliverContent(context: HttpRouteContext, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
	try {
		await pipeline(Readable.from([bytes]), context.response, { signal });
	} catch (error) {
		if (signal.aborted || context.response.destroyed) {
			throw new AgentFailure('provider_unavailable', { cause: error });
		}
		throw error;
	}
}
