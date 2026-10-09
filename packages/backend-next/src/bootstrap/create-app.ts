import { SqliteRuntime } from '../platform/storage/sqlite/sqlite-runtime.js';
import { initializeSchema } from '../platform/storage/sqlite/schema.js';
import { targetMigrations } from '../modules/targets/schema.js';
import { registerModules } from './module-manifest.js';
import { SecretBox } from '../platform/security/secret-box.js';
import type { MachineConnectOptions } from '../platform/ssh/ssh-port.js';

export interface AppOptions {
	/** 32-byte application-managed key. Required for storing or resolving credentials. */
	encryptionKey?: Uint8Array;
	/** Explicit host-key trust owner for internal Remote SSH. Missing policy denies SSH opens. */
	verifyHostKey?: MachineConnectOptions['verifyHostKey'];
}

type RegisteredModules = ReturnType<typeof registerModules>;

async function closeResources(modules: RegisteredModules, db: SqliteRuntime): Promise<void> {
	const failures: unknown[] = [];
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
		throw new AggregateError(failures, 'Remote and SQLite shutdown failed');
	}
}

function createCloseHandler(modules: RegisteredModules, db: SqliteRuntime): () => Promise<void> {
	let closePromise: Promise<void> | null = null;

	return function close(): Promise<void> {
		if (closePromise) {
			return closePromise;
		}
		modules.quiesce();
		closePromise = Promise.resolve().then(() => closeResources(modules, db));
		return closePromise;
	};
}

export async function createApp(dbPath: string, options: AppOptions = {}) {
	const db = SqliteRuntime.open(dbPath);
	try {
		await initializeSchema(db, targetMigrations);
		const secrets = options.encryptionKey ? new SecretBox(options.encryptionKey) : null;
		const modules = registerModules(db, secrets, options.verifyHostKey ?? null);
		return {
			targets: modules.targets,
			/** Trusted backend-only capability; never mount on an unauthenticated transport. */
			trustedSshTargets: modules.trustedSshTargets,
			/** Internal Remote session owner; no HTTP or WebSocket routes are installed. */
			remote: modules.remote,

			close: createCloseHandler(modules, db),
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
