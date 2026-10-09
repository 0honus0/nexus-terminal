import { SqliteRuntime } from '../platform/storage/sqlite/sqlite-runtime.js';
import { initializeSchema } from '../platform/storage/sqlite/schema.js';
import { targetMigrations } from '../modules/targets/schema.js';
import { registerModules } from './module-manifest.js';
import { SecretBox } from '../platform/security/secret-box.js';

export interface AppOptions {
	/** 32-byte application-managed key. Required for storing or resolving credentials. */
	encryptionKey?: Uint8Array;
}

export async function createApp(dbPath: string, options: AppOptions = {}) {
	const db = SqliteRuntime.open(dbPath);
	try {
		await initializeSchema(db, targetMigrations);
		const secrets = options.encryptionKey ? new SecretBox(options.encryptionKey) : null;
		const modules = registerModules(db, secrets);
		let closed = false;
		return {
			targets: modules.targets,
			/** Trusted backend-only capability; never mount on an unauthenticated transport. */
			trustedSshTargets: modules.trustedSshTargets,

			close: async () => {
				if (closed) return;
				closed = true;
				await db.close();
			},
		};
	} catch (error) {
		await db.close();
		throw error;
	}
}
