import { readPackageVersion } from '../platform/packages/adapters/node-package-version.js';
import { NativeBoundedFetch } from '../platform/network/adapters/native-bounded-fetch.js';
import { NativeImageInspector } from '../platform/images/adapters/native-image-inspector.js';
import {
	registerOperations,
	registerOperationsBackup,
	type OperationsRegistration,
} from '../modules/operations/register.js';
import { NativeBlobStore } from '../platform/blobs/adapters/native-blob-store.js';
import {
	registerPreferences,
	registerPreferencesBackup,
	type PreferencesRegistrationOptions,
} from '../modules/preferences/register.js';
import { registerTargets, registerTargetsBackup } from '../modules/targets/register.js';
import { registerRemote, registerRemoteBackup } from '../modules/remote/register.js';
import { Ssh2MachineFactory } from '../platform/ssh/adapters/ssh2/ssh-machine.js';
import type { SqliteRuntime } from '../platform/storage/sqlite/sqlite-runtime.js';
import type { SecretBox } from '../platform/security/secret-box.js';
import type { MachineConnectOptions } from '../platform/ssh/ssh-port.js';
import type { TargetsPublicApi, TrustedSshTargetResolver } from '../modules/targets/public.js';
import type { RemoteSessions } from '../modules/remote/public.js';
import { registerAccess, registerAccessBackupExclusions } from '../modules/access/register.js';
import type { AccessPublicApi } from '../modules/access/public.js';
import type { HttpRoute, HttpWebSocketRoute } from '../platform/http/http-types.js';
import { registerAgent, registerAgentBackup } from '../modules/agent/register.js';
import type { AgentStateApi } from '../modules/agent/public.js';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { registerSystem, type BackupMaintenance } from '../modules/system/register.js';
import { AccessOperationError } from '../modules/access/public-errors.js';
import { SqliteSnapshotCollector } from '../platform/storage/sqlite/adapters/snapshot-sql.js';
import { BACKUP_MAX_SNAPSHOT_BYTES } from '@nexus-terminal/shared/system/backups/values';
import { applicationMigrations } from './schema.js';
import { NativeSnapshotRestoreFiles } from '../platform/storage/sqlite/adapters/snapshot-restore-files.js';

export interface RegisteredModules {
	allowedOrigins: readonly string[];
	access: AccessPublicApi;
	admitUnmatchedHttp(sourceIp: string): Promise<boolean>;
	initialize(mode: 'startup' | 'restore'): Promise<void>;
	httpRoutes(secureCookies: boolean): HttpRoute[];
	webSocketRoutes(): HttpWebSocketRoute[];
	targets: TargetsPublicApi;
	trustedSshTargets: TrustedSshTargetResolver;
	remote: RemoteSessions;
	agent: AgentStateApi;
	quiesce(): void;
	close(): Promise<void>;
	retireForRestore(): Promise<void>;
}

interface ModuleRegistrationOptions {
	sqlite: SqliteRuntime;
	secrets: SecretBox | null;
	verifyHostKey: MachineConnectOptions['verifyHostKey'] | null;
	configuration?: PreferencesRegistrationOptions['seed'];
	guacd?: { host: string; port: number };
	maintenance: BackupMaintenance;
}

interface ModuleLifecycle {
	quiesce(): void;
	close(): Promise<void>;
}

function quiesceModuleOwners(owners: readonly Pick<ModuleLifecycle, 'quiesce'>[]): void {
	const failures: unknown[] = [];
	for (const owner of owners) {
		try {
			owner.quiesce();
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length) {
		throw new AggregateError(failures, 'Module quiesce failed');
	}
}

async function closeModuleOwners(owners: readonly ModuleLifecycle[]): Promise<void> {
	const failures: unknown[] = [];
	try {
		quiesceModuleOwners(owners);
	} catch (error) {
		failures.push(error);
	}
	const results = await Promise.allSettled(owners.map((owner) => Promise.resolve().then(() => owner.close())));
	for (const result of results) {
		if (result.status === 'rejected') {
			failures.push(result.reason);
		}
	}
	if (failures.length) {
		throw new AggregateError(failures, 'Module shutdown failed');
	}
}

/** Only independent business lifecycle owners appear here. */
export async function registerModules({
	sqlite,
	secrets,
	verifyHostKey,
	configuration,
	guacd,
	maintenance,
}: ModuleRegistrationOptions): Promise<RegisteredModules> {
	const backgrounds = await NativeBlobStore.open(sqlite.path + '.appearance');
	const artifacts = await NativeBlobStore.open(sqlite.path + '.artifacts');
	const plugins = await NativeBlobStore.open(sqlite.path + '.plugins');
	const preferences = await registerPreferences({
		sqlite,
		secrets,
		seed: configuration,
		backgrounds,
		imageInspector: new NativeImageInspector(),
		network: new NativeBoundedFetch(),
		githubToken: process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || null,
	});
	const installed = preferences.installation;
	const owners: ModuleLifecycle[] = [preferences];
	let operationOwner: OperationsRegistration | null = null;

	const closeOwners = async () => {
		const results = await Promise.allSettled([closeModuleOwners(owners)]);
		const operationResult = await Promise.allSettled([Promise.resolve().then(() => operationOwner?.close())]);
		const failures = [...results, ...operationResult].flatMap((result) =>
			result.status === 'rejected' ? [result.reason] : [],
		);
		if (failures.length) {
			throw new AggregateError(failures, 'Application owners failed to close');
		}
	};

	try {
		const operations = registerOperations(sqlite, secrets);
		operationOwner = operations;
		const access = registerAccess({
			sqlite,
			secrets,
			passkeys: installed.passkeys.map((site) => ({ origin: site.origin, rpId: site.rpId })),
			loginFailurePolicy: {
				enabled: installed.ipBlacklistEnabled,
				maxAttempts: installed.maxLoginAttempts,
				banSeconds: installed.loginBanDuration,
			},
			ipWhitelist: installed.ipWhitelist,
			captcha: {
				enabled: installed.captcha.enabled,
				provider: installed.captcha.provider,
				siteKey: installed.captcha.siteKey,
				secretKey: installed.captcha.secretKey,
				expectedHostname: installed.captcha.expectedHostname ?? undefined,
			},
		});
		preferences.installTransactionIdentityReader(access.readTransactionIdentity);
		operations.installTransactionIdentityReader(access.readTransactionIdentity);
		const targets = registerTargets({ sqlite, secrets });
		targets.installTransactionIdentityReader(access.readTransactionIdentity);
		const remote = registerRemote({
			sqlite,
			resolver: targets.trustedSshTargets,
			ssh: new Ssh2MachineFactory(),
			verifyHostKey,
			hostKeys: targets.publicApi.hostKeys,
			targets: targets.publicApi,
			access: access.publicApi,
			logDirectory: dirname(sqlite.path),
			events: operations.publicApi,
			guacdHost: guacd?.host ?? 'localhost',
			guacdPort: guacd?.port ?? 4822,
			statusIntervalSeconds: installed.statusMonitorIntervalSeconds,
			resourceRefreshSeconds: installed.remoteHostRefreshIntervalSeconds,
		});
		owners.push(remote);
		remote.installTransactionIdentityReader(access.readTransactionIdentity);
		const snapshot = new SqliteSnapshotCollector(
			sqlite,
			[
				registerTargetsBackup(secrets),
				registerPreferencesBackup(secrets),
				registerAgentBackup(secrets),
				registerRemoteBackup(),
				registerOperationsBackup(secrets),
			],
			new Map([
				['appearance', backgrounds],
				['artifacts', artifacts],
				['plugins', plugins],
			]),
			BACKUP_MAX_SNAPSHOT_BYTES,
			applicationMigrations[0].signature,
			registerAccessBackupExclusions(),
			new NativeSnapshotRestoreFiles(
				sqlite.path,
				new Map([
					['appearance', sqlite.path + '.appearance'],
					['artifacts', sqlite.path + '.artifacts'],
					['plugins', sqlite.path + '.plugins'],
				]),
			),
		);
		const system = registerSystem(access.publicApi, sqlite, snapshot, secrets, maintenance);
		owners.push(system);
		const agent = registerAgent(
			sqlite,
			secrets,
			targets.publicApi,
			targets.trustedSshTargets,
			remote.operations,
			artifacts,
			operations.publicApi,
			system.diagnostics,
			plugins,
			await readPackageVersion(new URL('../../package.json', import.meta.url)),
		);
		agent.installTransactionIdentityReader(access.readTransactionIdentity);
		owners.push(agent);

		const admitHttp = (routes: HttpRoute[]): HttpRoute[] =>
			routes.map((route) => ({
				method: route.method,
				path: route.path,
				...(route.maxBodyBytes === undefined ? {} : { maxBodyBytes: route.maxBodyBytes }),
				...(route.maxPathParameterBytes === undefined
					? {}
					: { maxPathParameterBytes: route.maxPathParameterBytes }),
				...(route.pathParameterAlphabet === undefined
					? {}
					: { pathParameterAlphabet: route.pathParameterAlphabet }),

				handle: async (context) => {
					let allowed: boolean;
					try {
						const authenticationRoute =
							route.path === '/api/v1/auth/login' ||
							route.path === '/api/v1/auth/login/2fa' ||
							route.path === '/api/v1/auth/passkey/authentication-options' ||
							route.path === '/api/v1/auth/passkey/authenticate' ||
							route.path === '/api/v1/auth/passkey/has-configured' ||
							route.path === '/api/v1/auth/status' ||
							route.path === '/api/v1/auth/logout' ||
							route.path === '/api/v1/settings/ip-blacklist';
						allowed = await (authenticationRoute
							? access.publicApi.admitAuthenticationSource(context.sourceIp)
							: access.publicApi.admitSource(context.sourceIp));
					} catch (error) {
						const code =
							error instanceof AccessOperationError &&
							(error.code === 'storage_unavailable' || error.code === 'operation_unknown')
								? error.code
								: 'internal_failure';
						context.send(503, { code });
						return;
					}
					if (!allowed) {
						await operations.publicApi.publish({
							key: randomUUID(),
							event: 'IP_BLOCKED',
							userId: null,
							subjectId: null,
							sourceIp: context.sourceIp,
							route: route.path,
							statusCode: 403,
						});
						context.send(403, { code: 'forbidden' });
						return;
					}
					await route.handle(context);
				},
			}));

		const admitWebSocket = (routes: HttpWebSocketRoute[]): HttpWebSocketRoute[] =>
			routes.map((route) => ({
				path: route.path,
				...(route.maxTextMessageBytes === undefined ? {} : { maxTextMessageBytes: route.maxTextMessageBytes }),
				...(route.maxBinaryMessageBytes === undefined
					? {}
					: { maxBinaryMessageBytes: route.maxBinaryMessageBytes }),
				...(route.maxBufferedTextBytes === undefined
					? {}
					: { maxBufferedTextBytes: route.maxBufferedTextBytes }),

				authorize: async (request, url, sourceIp) =>
					(await access.publicApi.admitSource(sourceIp)) && route.authorize(request, url, sourceIp),

				...(route.connected === undefined ? {} : { connected: route.connected }),
				...(route.connectedRaw === undefined ? {} : { connectedRaw: route.connectedRaw }),
			}));

		let closePromise: Promise<void> | null = null;
		return {
			allowedOrigins: installed.passkeys.map((site) => site.origin),
			access: access.publicApi,

			admitUnmatchedHttp: (sourceIp) => access.publicApi.admitSource(sourceIp),

			initialize: async (mode) => {
				await operations.initialize(mode);
				await agent.initialize(mode);
				await remote.initialize();
			},

			httpRoutes: (secureCookies) =>
				admitHttp([
					...operations.observe(
						[
							...access.routes(secureCookies),
							...targets.routes(access.publicApi),
							...remote.httpRoutes(),
							...agent.routes(access.publicApi),
							...system.httpRoutes(),
							...preferences.routes(access.publicApi),
							...operations.routes(access.publicApi),
						],
						access.publicApi,
					),
					...system.maintenanceRoutes(),
				]),

			webSocketRoutes: () => admitWebSocket(remote.webSocketRoutes()),

			targets: targets.publicApi,
			trustedSshTargets: targets.trustedSshTargets,
			remote: remote.publicApi,
			agent: agent.publicApi,

			quiesce: () => {
				quiesceModuleOwners([operations, preferences, agent, system, remote]);
			},

			retireForRestore: async () => {
				// HTTP and external capability admission are already stopped by the application owner.
				// Backups retains the admitted import task; Operations has no import wrapper occupancy.
				const results = await Promise.allSettled([
					closeModuleOwners(owners.filter((owner) => owner !== system)),
					Promise.resolve().then(() => system.closeForRestore()),
				]);
				const operationResults = await Promise.allSettled([Promise.resolve().then(() => operations.close())]);
				const failures = [...results, ...operationResults].flatMap((result) =>
					result.status === 'rejected' ? [result.reason] : [],
				);
				if (failures.length) {
					throw new AggregateError(failures, 'Application maintenance drain failed');
				}
			},

			close: () => {
				if (closePromise) {
					return closePromise;
				}
				closePromise = Promise.resolve().then(() => closeOwners());
				return closePromise;
			},
		};
	} catch (error) {
		try {
			await closeOwners();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Module installation and cleanup failed');
		}
		throw error;
	}
}
