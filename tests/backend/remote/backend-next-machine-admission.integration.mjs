import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { initializeMachineMutations } from '../../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-schema.js';
import { SqliteMachineMutationStorage } from '../../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-sql.js';
import { MachineCommandModel } from '../../../packages/backend/dist/modules/remote/machines/model/command-model.js';
import { RemoteMachineOperationService } from '../../../packages/backend/dist/modules/remote/machines/service/operation-service.js';
import { MACHINE_CONNECT_MAX_TIMEOUT_MS } from '../../../packages/backend/dist/platform/ssh/ssh-port.js';

await test('Mutation admission checks all resource keys atomically and preserves blocked evidence', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-mutation-admission-'));
	const db = SqliteRuntime.open(join(directory, 'state.db'));
	t.after(() => db.close());
	await db.transaction(initializeMachineMutations);
	const storage = new SqliteMachineMutationStorage(db);
	storage.installTransactionIdentityReader(async () => 1);

	const resourceKey = (value) => createHash('sha256').update(value).digest('hex');

	const claim = (keys) => ({
		id: randomUUID(),
		keys: keys.map(resourceKey),
		ownerId: randomUUID(),
		origin: 'agent',
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

await test('Machine execution accepts a long caller budget and independently caps SSH handshake', async () => {
	let connectBudget;
	let commandBudget;
	let closed = 0;
	const result = { status: 'completed', exitCode: 0, signal: null, stdout: 'done', stderr: '', truncated: false };
	const commands = new MachineCommandModel(
		{
			async open(input) {
				connectBudget = input.timeoutMs;
				return {
					machine: {
						execute() {
							throw new Error('Unused transport seam');
						},

						async close() {
							closed++;
						},
					},
				};
			},
		},
		{
			async execute(_executor, _command, _cwd, options) {
				commandBudget = options.timeoutMs;
				return {
					outcome: { status: 'completed', exitCode: 0, signal: null },
					stdout: 'done',
					stderr: '',
					truncated: false,
				};
			},
		},
	);
	const service = new RemoteMachineOperationService(null, null, commands, null, {
		async run(_id, _origin, _targets, work) {
			return work();
		},
	});
	try {
		const value = await service.executeCommand(
			{
				operationId: randomUUID(),
				targetId: 1,
				fingerprint: 'a'.repeat(64),
				timeoutMs: 650000,
				signal: new AbortController().signal,

				async validate() {},
			},
			{ command: { kind: 'argv', argv: ['true'] }, cwd: null },
		);
		assert.deepEqual(value, result);
		assert.equal(connectBudget, MACHINE_CONNECT_MAX_TIMEOUT_MS);
		assert.ok(commandBudget > MACHINE_CONNECT_MAX_TIMEOUT_MS && commandBudget <= 650000);
		assert.equal(closed, 1);
	} finally {
		await service.close();
	}
});
