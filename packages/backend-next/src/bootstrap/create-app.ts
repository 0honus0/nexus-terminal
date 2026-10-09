import { SqliteRuntime } from '../platform/storage/sqlite/sqlite-runtime.js';
import { initializeSchema } from '../platform/storage/sqlite/schema.js';
import { initializeTargetsSchema } from '../modules/targets/schema.js';
import { registerModules } from './module-manifest.js';

export async function createApp(dbPath: string) {
	const db = SqliteRuntime.open(dbPath);
	try {
		await initializeSchema(db, initializeTargetsSchema);
		const modules = registerModules(db);
		let closed = false;
		return {
			targets: modules.targets,
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
