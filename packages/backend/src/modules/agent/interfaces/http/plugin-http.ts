import { agentHttpSerializer, agentHttpErrorHandler } from './agent-http-response.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
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
import { readAgentId, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
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
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
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
	toPluginInstallationList,
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
		action: (request: HttpRequest, actor: PluginActor, input: AgentHttpInput) => Promise<unknown>,
		maxBodyBytes = AGENT_PLUGIN_MAX_BODY_BYTES,
		maxResponseBytes = AGENT_PLUGIN_MAX_RESPONSE_BYTES,
	): void {
		routes.push({
			method,
			url: (path.startsWith('/onboarding/') ? '/api/v1/agent' : '/api/v1/agent/plugins') + path,
			bodyLimit: maxBodyBytes,
			errorHandler: agentHttpErrorHandler,

			async handler(request, reply) {
				const input = new AgentHttpInput(request);
				let completed = false;
				try {
					const queryKeys = path === '/remote/catalog' ? ['repositoryUrl'] : [];
					if (
						[...request.query.keys()].some(
							(key) => !queryKeys.includes(key) || request.query.getAll(key).length !== 1,
						)
					) {
						throw new InvalidAgentPayload();
					}
					const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
						identity = await access.authenticate(token);
					if (!token || !identity) {
						reply.code(401).send({ code: 'unauthenticated' });
						return;
					}
					if (identity.userId !== 1) {
						reply.code(403).send({ code: 'forbidden' });
						return;
					}
					const actor = { userId: identity.userId, token };
					const result = await boundary(() => input.normalize(() => action(request, actor, input)));
					completed = method !== 'GET';
					if ((await access.authenticate(token))?.userId !== actor.userId) {
						reply
							.code(completed ? 503 : 401)
							.send({ code: completed ? 'operation_unknown' : 'unauthenticated' });
						return;
					}
					reply
						.type('application/json; charset=utf-8')
						.serializer(
							agentHttpSerializer(maxResponseBytes, completed ? 'operation_unknown' : 'limit_exceeded'),
						);
					reply.code(200).send(result);
				} catch (error) {
					if (reply.sent || reply.raw.headersSent || reply.raw.destroyed || reply.raw.writableEnded) {
						reply.raw.destroy();
						return;
					}
					if (completed) {
						reply.code(503).send({ code: 'operation_unknown' });
						return;
					}
					if (error instanceof InvalidAgentPayload) {
						reply.code(400).send({ code: 'invalid_input' });
					} else if (error instanceof AgentOperationError) {
						reply.code(agentErrorStatus(error.code)).send({ code: error.code });
					} else if (error instanceof AccessOperationError) {
						reply.code(error.code === 'storage_unavailable' ? 503 : 500).send({
							code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
						});
					} else {
						reply.code(500).send({ code: 'internal_failure' });
					}
				}
			},
		});
	}

	add(
		'GET',
		'/installations/:appId/data-snapshot',
		async (request, actor) =>
			toPluginDataSnapshot(await service.dataSnapshot(actor, readAgentId(request.params.appId))),
		AGENT_PLUGIN_MAX_BODY_BYTES,
		AGENT_PLUGIN_MAX_MIGRATION_BYTES,
	);
	add(
		'POST',
		'/installations/:appId/migrate-data',
		async (request, actor, reader) =>
			toPluginDataMigrationResult(
				await service.migrateData(actor, readAgentId(request.params.appId), async (signal) =>
					fromPluginDataMigration(await reader.read(readAgentPluginDataMigration, signal)),
				),
			),
		AGENT_PLUGIN_MAX_MIGRATION_BYTES,
	);
	add('POST', '/installations/:appId/prepare-upgrade', async (request, actor, reader) => {
		const input = await reader.read(readAgentPluginUpgrade);
		return toPluginInstallation(
			await service.prepareUpgrade(
				actor,
				readAgentId(request.params.appId),
				input.expectedRevision,
				input.stageId,
				input.expectedStageVersion,
			),
		);
	});
	add('POST', '/installations/:appId/delete-data', async (request, actor, reader) => {
		const input = await reader.read(readAgentPluginDataPurge);
		return toPluginDataPurge(
			await service.purgeData(
				actor,
				readAgentId(request.params.appId),
				input.expectedRevision,
				input.operationId,
			),
		);
	});
	routes.push(createPluginRpcHttpRoute(access, service, boundary));
	add('GET', '/installations/:appId/data/:key', async (request, actor) => {
		const value = await service.readData(
			actor,
			readAgentId(request.params.appId),
			readAgentPluginDataKey(request.params.key),
		);
		return { value: value === null ? null : toPluginData(value) };
	});
	add(
		'PUT',
		'/installations/:appId/data/:key',
		async (request, actor, reader) => {
			const key = readAgentPluginDataKey(request.params.key);
			return toPluginData(
				await service.mutateData(actor, readAgentId(request.params.appId), async (signal) => {
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
	add('DELETE', '/installations/:appId/data/:key', async (request, actor, reader) => {
		const key = readAgentPluginDataKey(request.params.key);
		return toPluginData(
			await service.mutateData(actor, readAgentId(request.params.appId), async (signal) => {
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
		async (request, actor) =>
			toPluginCatalog(
				await repositories.catalog(actor, readAgentPluginRepositoryUrl(request.query.get('repositoryUrl'))),
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

	add('GET', '/versions', async (_ctx, actor) => ({
		items: (await service.versions(actor)).map(toPluginVersion),
	}));
	add('GET', '/installations/:appId/descriptor', async (request, actor) =>
		toPluginDescriptor(await service.descriptor(actor, readAgentId(request.params.appId))),
	);
	add('POST', '/installations/:appId/upgrade', async (request, actor, reader) => {
		const input = await reader.read(readAgentPluginUpgrade);
		return toPluginInstallation(
			await service.upgrade(
				actor,
				readAgentId(request.params.appId),
				input.expectedRevision,
				input.stageId,
				input.expectedStageVersion,
			),
		);
	});
	add('DELETE', '/installations/:appId', async (request, actor, reader) => {
		const input = await reader.read(readAgentPluginRetirement);
		return toPluginInstallation(
			await service.remove(actor, readAgentId(request.params.appId), input.expectedRevision),
		);
	});
	add('POST', '/installations/:appId/cancel-retirement', async (request, actor, reader) => {
		const input = await reader.read(readAgentPluginRetirement);
		return toPluginInstallation(
			await service.cancelRetirement(actor, readAgentId(request.params.appId), input.expectedRevision),
		);
	});
	add('GET', '/installations', async (_ctx, actor) =>
		toPluginInstallationList(await service.installationDirectory(actor)),
	);
	add('POST', '/install', async (_request, actor, reader) => {
		const input = await reader.read(readAgentPluginInstall);
		return toPluginInstallation(await service.install(actor, input.stageId, input.expectedVersion));
	});
	add('GET', '/stages', async (_ctx, actor) => ({ items: (await service.stages(actor)).map(toPluginStage) }));
	add('GET', '/installations/:appId/runtime', async (request, actor) => {
		const value = await service.runtimeObservation(actor, readAgentId(request.params.appId));
		return value === null ? null : toPluginRuntimeObservation(value);
	});
	add('GET', '/installations/:appId/runtime/:instanceId', async (request, actor) => {
		const value = await service.runtimeObservation(
			actor,
			readAgentId(request.params.appId),
			readAgentId(request.params.instanceId),
		);
		return value === null ? null : toPluginRuntimeObservation(value);
	});
	add('POST', '/installations/:appId/runtime/acknowledge', async (request, actor, input) => {
		const command = await input.read(readAgentPluginRuntimeAcknowledgement);
		return toPluginRuntimeObservation(
			await service.acknowledgeRuntime(actor, readAgentId(request.params.appId), {
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
	add('POST', '/publishers', async (_request, actor, reader) => {
		const input = await reader.read(readAgentPluginPublisher);
		return toPluginPublisher(await service.putPublisher(actor, input.label, input.publicKeyPem));
	});
	add('DELETE', '/publishers/:keyId', async (request, actor, reader) => {
		const keyId = request.params.keyId;
		if (!keyId || !/^ed25519:[a-f0-9]{64}$/u.test(keyId)) {
			throw new InvalidAgentPayload();
		}
		return toPluginPublisher(
			await service.revokePublisher(actor, keyId, await reader.read(readAgentPluginVersion)),
		);
	});
	add('POST', '/stage', async (_request, actor, reader) => {
		const input = await reader.read(readAgentPluginStage);
		return toPluginStage(
			await service.stage(actor, {
				artifactAppId: input.artifactAppId,
				artifactId: input.artifactId,
				expectedVersion: input.expectedVersion,
			}),
		);
	});
	add('GET', '/stages/:stageId', async (request, actor) =>
		toPluginStage(await service.getStage(actor, readAgentId(request.params.stageId))),
	);
	add('POST', '/verify', async (_request, actor, reader) => {
		const input = await reader.read(readAgentPluginInstall);
		return toPluginStage(await service.verify(actor, input.stageId, input.expectedVersion));
	});
	return routes;
}

export function createPluginContentRoutes(
	service: PluginService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute[] {
	const sdk = (path: string, resolve: (request: HttpRequest, reply: HttpReply) => string): HttpRoute => ({
		method: 'GET',
		url: path,
		helmet: { crossOriginResourcePolicy: { policy: 'cross-origin' } },

		async handler(request, reply) {
			try {
				if ([...request.query.keys()].length) {
					throw new InvalidAgentPayload();
				}
				await boundary(() =>
					service.sdkAsset(resolve(request, reply), async (content, signal) => {
						reply.hijack();
						reply.raw.writeHead(200, {
							'Content-Type': 'text/javascript; charset=utf-8',
							'Content-Length': String(content.bytes.byteLength),
							'Cache-Control': 'no-store',
							'Access-Control-Allow-Origin': '*',
						});
						await deliverContent(reply, content.bytes, signal);
					}),
				);
			} catch (error) {
				if (reply.sent || reply.raw.headersSent) {
					reply.raw.destroy();
					return;
				}
				if (error instanceof InvalidAgentPayload) {
					reply.code(400).send({ code: 'invalid_input' });
				} else if (error instanceof AgentOperationError) {
					reply.code(agentErrorStatus(error.code)).send({ code: error.code });
				} else {
					reply.code(500).send({ code: 'internal_failure' });
				}
			}
		},
	});

	return [
		sdk('/sdk/frontend-v1.mjs', () => 'frontend-v1.mjs'),
		{
			method: 'GET',
			url: '/plugins/:appId/:version/:grant/*',
			helmet: {
				referrerPolicy: { policy: 'no-referrer' },
				crossOriginResourcePolicy: { policy: 'cross-origin' },
				contentSecurityPolicy: {
					useDefaults: false,
					directives: {
						sandbox: ['allow-scripts'],
						defaultSrc: ["'none'"],
						scriptSrc: ["'self'"],
						styleSrc: ["'self'"],
						imgSrc: ["'self'", 'data:'],
						fontSrc: ["'self'"],
						connectSrc: ["'none'"],
						objectSrc: ["'none'"],
						baseUri: ["'none'"],
						formAction: ["'none'"],
						frameAncestors: ["'self'"],
					},
				},
			},

			async handler(request, reply) {
				try {
					if ([...request.query.keys()].length) {
						throw new InvalidAgentPayload();
					}
					const appId = readAgentId(request.params.appId),
						grant = readAgentId(request.params.grant),
						version = request.params.version,
						path = request.params['*'];
					if (
						!version ||
						!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/u.test(version) ||
						!path ||
						path.includes('\\') ||
						path.includes('\0') ||
						path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
					) {
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
							reply.hijack();
							reply.raw.writeHead(200, {
								'Content-Type': types[path.split('.').at(-1) ?? ''] ?? 'application/octet-stream',
								'Content-Length': String(content.bytes.byteLength),
								'Cache-Control': 'no-store',
								'Access-Control-Allow-Origin': '*',
								ETag: '"' + content.sha256 + '"',
							});
							await deliverContent(reply, content.bytes, signal);
						}),
					);
				} catch (error) {
					if (reply.sent || reply.raw.headersSent) {
						reply.raw.destroy();
						return;
					}
					if (error instanceof InvalidAgentPayload) {
						reply.code(400).send({ code: 'invalid_input' });
					} else if (error instanceof AgentOperationError) {
						reply.code(agentErrorStatus(error.code)).send({ code: error.code });
					} else {
						reply.code(500).send({ code: 'internal_failure' });
					}
				}
			},
		},
	];
}

async function deliverContent(reply: HttpReply, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
	try {
		await pipeline(Readable.from([bytes]), reply.raw, { signal });
	} catch (error) {
		if (signal.aborted || reply.raw.destroyed) {
			throw new AgentFailure('provider_unavailable', { cause: error });
		}
		throw error;
	}
}
