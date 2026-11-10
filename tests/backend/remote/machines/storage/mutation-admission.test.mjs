import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRuntime } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { initializeMachineMutations } from '../../../../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-schema.js';
import { SqliteMachineMutationStorage } from '../../../../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-sql.js';

test('Mutation admission checks all resource keys atomically and preserves blocked evidence', async (t) => {
	const root = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(join(root, 'nexus-mutation-admission-'));
	const db = SqliteRuntime.open(join(directory, 'state.db'));
	t.onTestFinished(() => db.close());
	await db.transaction(initializeMachineMutations);
	const storage = new SqliteMachineMutationStorage(db);
	storage.installTransactionIdentityReader(async () => 1);

	const resourceKey = (value) => createHash('sha256').update(value).digest('hex');

	const claim = (keys) => ({
		id: randomUUID(),
		keys: keys.map(resourceKey),
		ownerId: randomUUID(),
		origin: 'tools',
		targets: keys.map((_, i) => ({ targetId: i + 1, fingerprint: 'a'.repeat(64) })),
		now: Date.now(),
	});

	const held = claim(['held']);
	const blocked = claim(['blocked']);
	assert.equal(await storage.acquire(held), 'acquired');
	assert.equal(await storage.acquire(blocked), 'acquired');
	await storage.settle(blocked.id, blocked.keys, true, Date.now());
	const before = await storage.get('fixture', blocked.id, () => {});
	assert.equal(await storage.acquire(claim(['held'])), 'conflict');
	assert.equal(await storage.acquire(claim(['held', 'blocked'])), 'blocked');
	assert.equal(await storage.acquire(claim(['blocked', 'held'])), 'blocked');
	assert.equal(await storage.acquire({ ...blocked, keys: [resourceKey('free')] }), 'blocked');
	assert.equal(await storage.acquire(claim(['free'])), 'acquired', 'rejected admission creates no partial lock');
	assert.deepEqual(await storage.get('fixture', blocked.id, () => {}), before);
});
