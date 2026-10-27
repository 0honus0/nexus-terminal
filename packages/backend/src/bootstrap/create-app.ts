import type { Logger } from '../platform/logging/logger.js';
import { PinoLogger } from '../platform/logging/pino-logger.js';
import { logDiagnostic } from '../platform/logging/diagnostic-log.js';
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
import type { PreferencesRegistrationOptions } from '../modules/preferences/register.js';
import type { BackupMaintenance } from '../modules/system/register.js';
import { NativeSnapshotRestoreFiles } from '../platform/storage/sqlite/adapters/snapshot-restore-files.js';
import { SqliteSnapshotRestore } from '../platform/storage/sqlite/adapters/snapshot-restore-sql.js';
import { CallAdmission } from '../platform/lifecycle/call-admission.js';
import { TargetOperationError } from '../modules/targets/public-errors.js';
import { AccessOperationError } from '../modules/access/public-errors.js';
import { AgentOperationError } from '../modules/agent/public-errors.js';
import { RemoteOperationError } from '../modules/remote/public-errors.js';
import { resolveDataPaths } from './data-paths.js';

export interface AppOptions {
	logger?: Logger;
	/** 32-byte application-managed key. Required for storing or resolving credentials. */
	encryptionKey?: Uint8Array;
	/** Explicit host-key trust owner for internal Remote SSH. Missing policy denies SSH opens. */
	verifyHostKey?: MachineConnectOptions['verifyHostKey'];
	/** Used only for first initialization; later starts load the durable configuration. */
	configuration?: PreferencesRegistrationOptions['seed'];
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
	getModules: () => RegisteredModules,
	setModules: (modules: RegisteredModules) => void,
	install: () => Promise<RegisteredModules>,
	db: SqliteRuntime,
	admission: CallAdmission,
	logger: Logger,
): Pick<BackendApplication, 'listenHttp' | 'close'> & { maintenance: BackupMaintenance } {
	let http: Promise<HttpListener> | null = null;
	let closePromise: Promise<void> | null = null;
	let httpOrigin: string | null = null;
	let restoring: Promise<void> | null = null;
	const retired = new Set<RegisteredModules>();
	const retirements = new Set<Promise<void>>();
	const retirementFailures: unknown[] = [];
	let restoreFailed = false;

	function finishRetirement(previous: RegisteredModules): void {
		const task = Promise.resolve().then(async () => {
			try {
				await previous.close();
			} catch (cause) {
				restoreFailed = true;
				admission.pause();
				// A late retirement failure must also stop the actual HTTP/WS consumers.
				// Another maintenance task already owns a suspension and must not resume it.
				if (http && !closePromise && !restoring) {
					try {
						await (await http).suspend().drain();
					} catch (cleanup) {
						throw new AggregateError([cause, cleanup], 'Retirement and transport suspension failed');
					}
				}
				throw cause;
			}
		});
		retirements.add(task);
		void task.then(
			() => {
				retirements.delete(task);
				retired.delete(previous);
			},
			(cause) => {
				retirements.delete(task);
				retirementFailures.push(cause);
				logDiagnostic(logger, 'error', 'RESTORE_RETIREMENT_FAILED', {}, cause);
			},
		);
	}

	const maintenance: BackupMaintenance = {
		run(request, apply) {
			if (closePromise || restoring || restoreFailed || !http || !httpOrigin) {
				return Promise.reject(new Error('Application maintenance unavailable'));
			}
			const listener = http;
			const secureCookies = new URL(httpOrigin).protocol === 'https:';
			let previous: RegisteredModules | null = null;
			const task = Promise.resolve().then(async () => {
				if (closePromise) {
					throw new Error('Application closing');
				}
				logDiagnostic(logger, 'info', 'RESTORE_DRAIN_STARTED');
				const lease = (await listener).suspend(request);
				admission.pause();
				const original = getModules();
				previous = original;
				retired.add(original);
				try {
					const outcomes = await Promise.allSettled([
						Promise.resolve().then(() => lease.drain()),
						Promise.resolve().then(() => admission.drain()),
						Promise.resolve().then(() => original.retireForRestore()),
					]);
					const failures = outcomes.flatMap((outcome) =>
						outcome.status === 'rejected' ? [outcome.reason] : [],
					);
					if (failures.length) {
						throw new AggregateError(failures, 'Maintenance admission or owners failed to drain');
					}
					logDiagnostic(logger, 'info', 'RESTORE_APPLY_STARTED');
					if (!(await apply())) {
						logDiagnostic(logger, 'error', 'RESTORE_APPLY_UNCONFIRMED');
						restoreFailed = true;
						return;
					}
					logDiagnostic(logger, 'info', 'RESTORE_REBUILD_STARTED');
					const replacement = await install();
					setModules(replacement);
					await replacement.initialize('restore');
					lease.replace({
						allowedOrigins: replacement.allowedOrigins,
						admitUnmatched: replacement.admitUnmatchedHttp,
						routes: replacement.httpRoutes(secureCookies),
						webSockets: replacement.webSocketRoutes(),
					});
					await new SqliteSnapshotRestore(db).initialized();
					if (!closePromise && !restoreFailed) {
						lease.resume();
						admission.resume();
						logDiagnostic(logger, 'info', 'RESTORE_COMPLETED');
					}
				} catch (cause) {
					logDiagnostic(logger, 'error', 'RESTORE_FAILED', {}, cause);
					restoreFailed = true;
					const current = getModules();
					if (current !== original) {
						const failures: unknown[] = [cause];
						try {
							current.quiesce();
						} catch (cleanup) {
							failures.push(cleanup);
						}
						try {
							await current.close();
						} catch (cleanup) {
							failures.push(cleanup);
						}
						if (failures.length > 1) {
							throw new AggregateError(failures, 'Maintenance rebuild and cleanup failed');
						}
					}
					throw cause;
				}
			});
			restoring = task;

			const settled = () => {
				restoring = null;
				// This runs outside the task; closing Backups may now wait for its import caller safely.
				if (previous) {
					finishRetirement(previous);
				}
			};

			void task.then(settled, settled);
			return task;
		},
	};

	function listenHttp(options: AccessHttpOptions): Promise<string> {
		if (closePromise || http) {
			return Promise.reject(new Error('HTTP already started or application closing'));
		}
		const secureCookies = new URL(options.publicOrigin).protocol === 'https:';
		const modules = getModules();
		httpOrigin = options.publicOrigin;
		const routes = modules.httpRoutes(secureCookies);
		http = openHttpListener({
			logger,
			publicOrigin: options.publicOrigin,
			allowedOrigins: modules.allowedOrigins,
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
			logDiagnostic(logger, 'info', 'APP_SHUTDOWN_STARTED');
			const failures: unknown[] = [];
			admission.pause();
			// Do not close SQLite or the import owner while its durable reconciliation is running.
			if (restoring) {
				try {
					await restoring;
				} catch (cause) {
					failures.push(cause);
				}
			}
			const modules = getModules();
			try {
				modules.quiesce();
			} catch (error) {
				failures.push(error);
			}
			try {
				await admission.drain();
				await Promise.allSettled([...retirements]);
				failures.push(...retirementFailures);
			} catch (error) {
				failures.push(error);
			}
			const outcomes = await Promise.allSettled(
				[...retired].map((owner) => Promise.resolve().then(() => owner.close())),
			);
			for (const outcome of outcomes) {
				if (outcome.status === 'rejected') {
					failures.push(outcome.reason);
				}
			}
			try {
				await closeResources(modules, db, http);
			} catch (error) {
				failures.push(error);
			}
			if (failures.length) {
				logDiagnostic(
					logger,
					'error',
					'APP_SHUTDOWN_FAILED',
					{ failureCount: failures.length },
					new AggregateError(failures),
				);
			} else {
				logDiagnostic(logger, 'info', 'APP_SHUTDOWN_COMPLETED');
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

	return { listenHttp, close, maintenance };
}

export async function createApp(dbPath: string, options: AppOptions = {}): Promise<BackendApplication> {
	const logger = options.logger ?? new PinoLogger();
	logDiagnostic(logger, 'info', 'APP_STARTUP_STARTED');
	let db: SqliteRuntime;
	try {
		db = SqliteRuntime.open(dbPath, logger);
	} catch (error) {
		logDiagnostic(logger, 'error', 'DATABASE_OPEN_FAILED', {}, error);
		throw error;
	}
	let modules: RegisteredModules | null = null;
	try {
		logDiagnostic(logger, 'info', 'DATABASE_SCHEMA_STARTED');
		await initializeSchema(db, applicationMigrations);
		logDiagnostic(logger, 'info', 'DATABASE_SCHEMA_READY');
		const paths = resolveDataPaths(db.path);
		// Recover files from durable SQL evidence before any module creates resources or reads state.
		const files = new NativeSnapshotRestoreFiles(
			db.path,
			new Map([
				['appearance', paths.appearance],
				['artifacts', paths.artifacts],
				['plugins', paths.plugins],
			]),
		);
		logDiagnostic(logger, 'info', 'STARTUP_RECOVERY_STARTED');
		await files.recover((id) => new SqliteSnapshotRestore(db).committed(id));
		logDiagnostic(logger, 'info', 'STARTUP_RECOVERY_COMPLETED');
		const secrets = options.encryptionKey ? new SecretBox(options.encryptionKey) : null;
		const admission = new CallAdmission();

		const getModules = (): RegisteredModules => {
			if (!modules) {
				throw new Error('Application modules unavailable');
			}
			return modules;
		};

		const install = () =>
			registerModules({
				sqlite: db,
				logger,
				secrets,
				verifyHostKey: options.verifyHostKey ?? null,
				configuration: options.configuration,
				maintenance: lifecycle.maintenance,
			});

		const lifecycle = createLifecycle(
			getModules,
			(replacement) => {
				modules = replacement;
			},
			install,
			db,
			admission,
			logger,
		);
		modules = await install();
		// Transient suspended SSH logs are not persistent SSH sessions.
		// Clear stale files before HTTP/WS endpoints can accept a new mark.
		const restore = new SqliteSnapshotRestore(db);
		await modules.initialize((await restore.needsInitialization()) ? 'restore' : 'startup');
		await restore.initialized();
		logDiagnostic(logger, 'info', 'APP_STARTUP_COMPLETED');
		return {
			targets: admission.bind(
				() => getModules().targets,
				() => new TargetOperationError('storage_unavailable'),
			),
			/** Trusted backend-only capability; never mount on HTTP. */
			trustedSshTargets: admission.bind(
				() => getModules().trustedSshTargets,
				() => new TargetOperationError('storage_unavailable'),
			),
			remote: admission.bind(
				() => getModules().remote,
				() => new RemoteOperationError('remote_unavailable'),
				[
					'get',
					'list',
					'write',
					'resize',
					'onData',
					'onStderr',
					'onDrain',
					'onClosed',
					'pauseOutput',
					'resumeOutput',
				],
			),
			access: admission.bind(
				() => getModules().access,
				() => new AccessOperationError('storage_unavailable'),
			),
			agent: admission.bind(
				() => getModules().agent,
				() => new AgentOperationError('provider_unavailable'),
			),
			listenHttp: lifecycle.listenHttp,
			close: lifecycle.close,
		};
	} catch (error) {
		logDiagnostic(logger, 'error', 'APP_STARTUP_FAILED', {}, error);
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
