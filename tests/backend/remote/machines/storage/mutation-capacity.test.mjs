import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { initializeSchema } from '../../../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { applicationMigrations } from '../../../../../packages/backend/dist/bootstrap/schema.js';
import { test } from 'vitest';
import { SqliteRuntime } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { SqliteMachineMutationStorage } from '../../../../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-sql.js';
import { registerRemoteSnapshot } from '../../../../../packages/backend/dist/modules/remote/snapshots/adapters/sqlite/snapshot-registration.js';

await test('mutation claims and backup validation retain 4100 independent endpoints without a global count rejection', async () => {
	const db = SqliteRuntime.openMemory();
	try {
		await initializeSchema(db, applicationMigrations);
		const storage = new SqliteMachineMutationStorage(db);
		const claims = Array.from({ length: 4_100 }, (_, index) => ({
			id: 'capacity-' + index,
			keys: [
				createHash('sha256')
					.update('endpoint-' + index)
					.digest('hex'),
			],
			ownerId: randomUUID(),
			origin: 'files',
			targets: [
				{
					targetId: index + 1,
					fingerprint: createHash('sha256')
						.update('fingerprint-' + index)
						.digest('hex'),
				},
			],
			now: Date.now(),
		}));
		for (const claim of claims) assert.equal(await storage.acquire(claim), 'acquired');
		assert.equal(await storage.acquire(claims[0]), 'conflict');
		assert.equal(await storage.acquire({ ...claims[0], id: 'same-endpoint' }), 'conflict');
		await storage.settle('capacity-0', claims[0].keys, false, Date.now());
		assert.equal(await storage.acquire({ ...claims[0], id: 'released-endpoint' }), 'acquired');
		await storage.reconcile(Date.now());
		const registration = registerRemoteSnapshot();
		const rows = new Map();
		for (const table of registration.tables) rows.set(table.name, await db.all('SELECT * FROM ' + table.name));
		await registration.validate(rows);
		assert.equal(rows.get('remote_machine_mutations').length, claims.length);
		assert.equal(
			rows.get('remote_machine_mutation_claims').filter((claim) => claim.state === 'blocked').length,
			claims.length,
		);
		await assert.rejects(storage.settle('released-endpoint', claims[0].keys, false, Date.now()));
		assert.equal(await storage.acquire({ ...claims[1], id: 'still-blocked-endpoint' }), 'blocked');
	} finally {
		await db.close();
	}
});
