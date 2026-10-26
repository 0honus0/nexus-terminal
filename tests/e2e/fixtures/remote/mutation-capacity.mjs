import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../../../../packages/backend/dist/bootstrap/create-app.js';
import { SqliteRuntime } from '../../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { SqliteMachineMutationStorage } from '../../../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-sql.js';
import { registerRemoteSnapshot } from '../../../../packages/backend/dist/modules/remote/snapshots/adapters/sqlite/snapshot-registration.js';

const dbPath = process.argv[2];
assert.ok(dbPath);
const app = await createApp(dbPath, { encryptionKey: randomBytes(32) });
await app.close();
const db = SqliteRuntime.open(dbPath);
try {
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
	await storage.settle('capacity-0', claims[0].keys, false, Date.now());
	assert.equal(await storage.acquire({ ...claims[0], id: 'released-endpoint' }), 'acquired');
	assert.equal(await storage.acquire({ ...claims[1], id: 'still-blocked-endpoint' }), 'conflict');
	console.log('Verified 4100 independent claims, snapshot integrity and endpoint conflict preservation');
} finally {
	await db.close();
}
