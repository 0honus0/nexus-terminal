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
	/** 32-byte application-managed key. Required for storing or resolving credentials. */
	encryptionKey?: Uint8Array;
	/** Explicit host-key trust owner for internal Remote SSH. Missing policy denies SSH opens. */
	verifyHostKey?: MachineConnectOptions['verifyHostKey'];
	/** Disabled unless explicitly enabled. Internal IPs are always exempt. */
	loginFailurePolicy?: AccessRegistrationOptions['loginFailurePolicy'];
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
	if (http) {
		try {
			const listener = await http;
			await listener.close();
		} catch (error) {
			failures.push(error);
		}
	}
	try {
		await modules.close();
	} catch (error) {
		failures.push(error);
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
		throw new AggregateError(failures, 'HTTP, Remote or SQLite shutdown failed');
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
			routes,
			webSockets: modules.webSocketRoutes(),
		});
		return http.then((listener) => listener.address);
	}

	function close(): Promise<void> {
		if (closePromise) {
			return closePromise;
		}
		modules.quiesce();
		closePromise = Promise.resolve().then(() => closeResources(modules, db, http));
		return closePromise;
	}

	return { listenHttp, close };
}

export async function createApp(dbPath: string, options: AppOptions = {}): Promise<BackendApplication> {
	const db = SqliteRuntime.open(dbPath);
	try {
		await initializeSchema(db, applicationMigrations);
		const secrets = options.encryptionKey ? new SecretBox(options.encryptionKey) : null;
		const modules = registerModules(db, secrets, options.verifyHostKey ?? null, options.loginFailurePolicy);
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
		try {
			await db.close();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Backend startup and cleanup both failed');
		}
		throw error;
	}
}
