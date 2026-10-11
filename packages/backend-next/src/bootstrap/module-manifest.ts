import { registerTargets } from '../modules/targets/register.js';
import { registerRemote } from '../modules/remote/register.js';
import { Ssh2MachineFactory } from '../platform/ssh/adapters/ssh2/ssh-machine.js';
import type { SqliteRuntime } from '../platform/storage/sqlite/sqlite-runtime.js';
import type { SecretBox } from '../platform/security/secret-box.js';
import type { MachineConnectOptions } from '../platform/ssh/ssh-port.js';
import type { TargetsPublicApi, TrustedSshTargetResolver } from '../modules/targets/public.js';
import type { RemoteSessions } from '../modules/remote/public.js';
import { registerAccess } from '../modules/access/register.js';
import type { AccessPublicApi } from '../modules/access/public.js';
import type { HttpRoute, HttpWebSocketRoute } from '../platform/http/http-types.js';
import { registerAgent } from '../modules/agent/register.js';
import type { AgentStateApi } from '../modules/agent/public.js';
import type { AccessRegistrationOptions } from '../modules/access/register.js';
import { dirname } from 'node:path';
import { registerSystem } from '../modules/system/register.js';
import { AccessOperationError } from '../modules/access/public-errors.js';

export interface RegisteredModules {
	access: AccessPublicApi;
	admitUnmatchedHttp(sourceIp: string): Promise<boolean>;
	initialize(): Promise<void>;
	httpRoutes(secureCookies: boolean): HttpRoute[];
	webSocketRoutes(): HttpWebSocketRoute[];
	targets: TargetsPublicApi;
	trustedSshTargets: TrustedSshTargetResolver;
	remote: RemoteSessions;
	agent: AgentStateApi;
	quiesce(): void;
	close(): Promise<void>;
}

interface ModuleRegistrationOptions {
	sqlite: SqliteRuntime;
	secrets: SecretBox | null;
	verifyHostKey: MachineConnectOptions['verifyHostKey'] | null;
	loginFailureOptions?: AccessRegistrationOptions['loginFailurePolicy'];
	guacd?: { host: string; port: number };
	ipWhitelist?: AccessRegistrationOptions['ipWhitelist'];
	captcha?: AccessRegistrationOptions['captcha'];
}

/** Only independent business lifecycle owners appear here. */
export function registerModules({
	sqlite,
	secrets,
	verifyHostKey,
	loginFailureOptions,
	guacd,
	ipWhitelist,
	captcha,
}: ModuleRegistrationOptions): RegisteredModules {
	const access = registerAccess({ sqlite, loginFailurePolicy: loginFailureOptions, ipWhitelist, captcha });
	const targets = registerTargets({ sqlite, secrets });
	const remote = registerRemote({
		resolver: targets.trustedSshTargets,
		ssh: new Ssh2MachineFactory(),
		verifyHostKey,
		hostKeys: targets.publicApi.hostKeys,
		targets: targets.publicApi,
		access: access.publicApi,
		logDirectory: dirname(sqlite.path),
		guacdHost: guacd?.host ?? 'localhost',
		guacdPort: guacd?.port ?? 4822,
	});
	const agent = registerAgent(sqlite);
	const system = registerSystem(access.publicApi);

	const admitHttp = (routes: HttpRoute[]): HttpRoute[] =>
		routes.map((route) => ({
			method: route.method,
			path: route.path,
			...(route.maxBodyBytes === undefined ? {} : { maxBodyBytes: route.maxBodyBytes }),

			handle: async (context) => {
				let allowed: boolean;
				try {
					const authenticationRoute =
						route.path === '/api/v1/auth/login' ||
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

			authorize: async (request, url, sourceIp) =>
				(await access.publicApi.admitSource(sourceIp)) && route.authorize(request, url, sourceIp),

			...(route.connected === undefined ? {} : { connected: route.connected }),
			...(route.connectedRaw === undefined ? {} : { connectedRaw: route.connectedRaw }),
		}));

	let closePromise: Promise<void> | null = null;
	return {
		access: access.publicApi,

		admitUnmatchedHttp: (sourceIp) => access.publicApi.admitSource(sourceIp),

		initialize: remote.initialize,

		httpRoutes: (secureCookies) =>
			admitHttp([
				...access.routes(secureCookies),
				...targets.routes(access.publicApi),
				...remote.httpRoutes(),
				...agent.routes(access.publicApi),
				...system.httpRoutes(),
			]),

		webSocketRoutes: () => admitWebSocket(remote.webSocketRoutes()),

		targets: targets.publicApi,
		trustedSshTargets: targets.trustedSshTargets,
		remote: remote.publicApi,
		agent: agent.publicApi,

		quiesce: () => {
			system.quiesce();
			remote.quiesce();
		},

		close: () => {
			if (closePromise) {
				return closePromise;
			}
			closePromise = Promise.resolve().then(async () => {
				const results = await Promise.allSettled([
					Promise.resolve().then(() => remote.close()),
					Promise.resolve().then(() => system.close()),
				]);
				const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
				if (failures.length) {
					throw new AggregateError(failures, 'Module shutdown failed');
				}
			});
			return closePromise;
		},
	};
}
