import { SqliteRuntime } from '../platform/storage/sqlite/sqlite-runtime.js';
import { initializeSchema } from '../platform/storage/sqlite/schema.js';
import { applicationMigrations } from './schema.js';
import { registerModules, type RegisteredModules } from './module-manifest.js';
import { SecretBox } from '../platform/security/secret-box.js';
import { openHttpListener } from '../platform/http/http-server.js';
import type { HttpListener } from '../platform/http/http-types.js';
import type { MachineConnectOptions } from '../platform/ssh/ssh-port.js';
import type { TargetsPublicApi, TrustedSshTargetResolver } from '../modules/targets/public.js';
import type { RemoteSessions } from '../modules/remote/public.js';
import type { AccessPublicApi } from '../modules/access/public.js';
import type { AgentStateApi } from '../modules/agent/public.js';
import type { AccessRegistrationOptions } from '../modules/access/register.js';

export interface AppOptions {
	guacd?: { host: string; port: number };
	/** 32-byte application-managed key. Required for storing or resolving credentials. */
	encryptionKey?: Uint8Array;
	/** Explicit host-key trust owner for internal Remote SSH. Missing policy denies SSH opens. */
	verifyHostKey?: MachineConnectOptions['verifyHostKey'];
	/** Disabled unless explicitly enabled. Internal IPs are always exempt. */
	loginFailurePolicy?: AccessRegistrationOptions['loginFailurePolicy'];
	ipWhitelist?: AccessRegistrationOptions['ipWhitelist'];
	captcha?: AccessRegistrationOptions['captcha'];
	passkeys?: AccessRegistrationOptions['passkeys'];
}

export interface AccessHttpOptions {
	publicOrigin: string;
	bindHost: string;
	port: number;
	trustedProxies?: readonly string[];
}

export interface BackendApplication {
	targets: TargetsPublicApi;
	trustedSshTargets: TrustedSshTargetResolver;
	remote: RemoteSessions;
	access: AccessPublicApi;
	agent: AgentStateApi;
	/** Access, Targets management and one-owner SSH Shell HTTP/WS. */
	listenHttp(options: AccessHttpOptions): Promise<string>;
	close(): Promise<void>;
}

async function closeResources(
	modules: RegisteredModules,
	db: SqliteRuntime,
	http: Promise<HttpListener> | null,
): Promise<void> {
	const failures: unknown[] = [];
	// The HTTP and module owners start closing independently; SQLite stays
	// open until both have settled because active use cases may still need it.
	const outcomes = await Promise.allSettled([
		Promise.resolve().then(async () => {
			if (http) {
				const listener = await http;
				await listener.close();
			}
		}),
		Promise.resolve().then(() => modules.close()),
	]);
	for (const outcome of outcomes) {
		if (outcome.status === 'rejected') {
			failures.push(outcome.reason);
		}
	}
	try {
		await db.close();
	} catch (error) {
		failures.push(error);
	}
	if (failures.length === 1) {
		throw failures[0];
	}
	if (failures.length > 1) {
		throw new AggregateError(failures, 'HTTP, modules or SQLite shutdown failed');
	}
}

function createLifecycle(
	modules: RegisteredModules,
	db: SqliteRuntime,
): Pick<BackendApplication, 'listenHttp' | 'close'> {
	let http: Promise<HttpListener> | null = null;
	let closePromise: Promise<void> | null = null;

	function listenHttp(options: AccessHttpOptions): Promise<string> {
		if (closePromise || http) {
			return Promise.reject(new Error('HTTP already started or application closing'));
		}
		const secureCookies = new URL(options.publicOrigin).protocol === 'https:';
		const routes = modules.httpRoutes(secureCookies);
		http = openHttpListener({
			publicOrigin: options.publicOrigin,
			bindHost: options.bindHost,
			port: options.port,
			trustedProxies: options.trustedProxies ?? ['loopback'],
			admitUnmatched: modules.admitUnmatchedHttp,
			routes,
			webSockets: modules.webSocketRoutes(),
		});
		return http.then((listener) => listener.address);
	}

	function close(): Promise<void> {
		if (closePromise) {
			return closePromise;
		}
		closePromise = Promise.resolve().then(async () => {
			const failures: unknown[] = [];
			try {
				modules.quiesce();
			} catch (error) {
				failures.push(error);
			}
			try {
				await closeResources(modules, db, http);
			} catch (error) {
				failures.push(error);
			}
			if (failures.length === 1) {
				throw failures[0];
			}
			if (failures.length > 1) {
				throw new AggregateError(failures, 'Application quiesce and close both failed');
			}
		});
		return closePromise;
	}

	return { listenHttp, close };
}

export async function createApp(dbPath: string, options: AppOptions = {}): Promise<BackendApplication> {
	const db = SqliteRuntime.open(dbPath);
	let modules: RegisteredModules | null = null;
	try {
		await initializeSchema(db, applicationMigrations);
		const secrets = options.encryptionKey ? new SecretBox(options.encryptionKey) : null;
		modules = registerModules({
			sqlite: db,
			secrets,
			verifyHostKey: options.verifyHostKey ?? null,
			loginFailureOptions: options.loginFailurePolicy,
			guacd: options.guacd,
			ipWhitelist: options.ipWhitelist,
			captcha: options.captcha,
			passkeys: options.passkeys,
		});
		// Transient suspended SSH logs are not persistent SSH sessions.
		// Clear stale files before HTTP/WS endpoints can accept a new mark.
		await modules.initialize();
		const lifecycle = createLifecycle(modules, db);
		return {
			targets: modules.targets,
			/** Trusted backend-only capability; never mount on HTTP. */
			trustedSshTargets: modules.trustedSshTargets,
			remote: modules.remote,
			access: modules.access,
			agent: modules.agent,
			listenHttp: lifecycle.listenHttp,
			close: lifecycle.close,
		};
	} catch (error) {
		const failures: unknown[] = [error];
		if (modules) {
			try {
				modules.quiesce();
			} catch (cleanupError) {
				failures.push(cleanupError);
			}
			try {
				await modules.close();
			} catch (cleanupError) {
				failures.push(cleanupError);
			}
		}
		try {
			await db.close();
		} catch (cleanupError) {
			failures.push(cleanupError);
		}
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Backend startup and cleanup both failed');
		}
		throw error;
	}
}
