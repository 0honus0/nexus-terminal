import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { SqliteMachineMutationStorage } from '../../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-sql.js';

/** Seed durable claims through the actual Adapter, then close before installing the actual recovering owner. */
export async function prepareDatabase(database, encryptionKey) {
	const application = await createApp(database, { encryptionKey });
	await application.close();
	const sqlite = SqliteRuntime.open(database);
	try {
		const storage = new SqliteMachineMutationStorage(sqlite);
		for (let index = 1; index <= 22; index++) {
			const id = 'fixture-' + String(index).padStart(2, '0');
			const key = createHash('sha256').update(id).digest('hex');
			assert.equal(
				await storage.acquire({
					id,
					keys: [key],
					ownerId: randomUUID(),
					origin: index % 2 ? 'retired' : 'files',
					targets: [{ targetId: index, fingerprint: key }],
					now: Date.now() - 10000,
				}),
				'acquired',
			);
			await storage.settle(id, [key], true, Date.now() - 5000);
		}
	} finally {
		await sqlite.close();
	}
}
