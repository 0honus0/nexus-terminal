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

export async function createApp(dbPath: string, options: AppOptions = {}) {
	const db = SqliteRuntime.open(dbPath);
	try {
		await initializeSchema(db, targetMigrations);
		const secrets = options.encryptionKey ? new SecretBox(options.encryptionKey) : null;
		const modules = registerModules(db, secrets, options.verifyHostKey ?? null);
		let closePromise: Promise<void> | null = null;
		return {
			targets: modules.targets,
			/** Trusted backend-only capability; never mount on an unauthenticated transport. */
			trustedSshTargets: modules.trustedSshTargets,
			/** Internal Remote session owner; no HTTP or WebSocket routes are installed. */
			remote: modules.remote,

			close: (): Promise<void> => {
				if (closePromise) return closePromise;
				modules.quiesce();
				closePromise = (async () => {
					let remoteFailure: unknown = null;
					try {
						await modules.close();
					} catch (error) {
						remoteFailure = error;
					}
					let storageFailure: unknown = null;
					try {
						await db.close();
					} catch (error) {
						storageFailure = error;
					}
					if (remoteFailure !== null && storageFailure !== null) {
						throw new AggregateError([remoteFailure, storageFailure], 'Remote and SQLite shutdown failed');
					}
					if (remoteFailure !== null) throw remoteFailure;
					if (storageFailure !== null) throw storageFailure;
				})();
				return closePromise;
			},
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
