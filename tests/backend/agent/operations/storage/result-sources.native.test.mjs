import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { operationStorageFixture, contentHash } from '../../../../support/operation-storage-fixture.mjs';
import { ResultService } from '../../../../../packages/backend/dist/modules/agent/context/service/result-service.js';
import { SqliteOperationActivityStorage } from '../../../../../packages/backend/dist/modules/agent/operations/adapters/sqlite/operation-activity-sql.js';
import { AgentFailure } from '../../../../../packages/backend/dist/modules/agent/agent-failure.js';

const refused = (code) => (error) => error instanceof AgentFailure && error.code === code;

const signal = new AbortController().signal;

await test('Tool activity: App title and private storage receipts stay durable without breaking tool reads', async (t) => {
	const f = await operationStorageFixture(t);
	await f.db.exec('CREATE TABLE agent_threads(id TEXT,user_id INTEGER,app_id TEXT)');
	const run = await f.db.one('SELECT thread_id FROM agent_runs WHERE id=?', [f.scope.runId]);
	await f.db.run('INSERT INTO agent_threads VALUES(?,1,?)', [run.thread_id, f.scope.appId]);
	const activity = new SqliteOperationActivityStorage(f.db);
	const tool = await f.insert({ kind: 'tool' });
	const native = await f.insert({ parentId: tool.id });
	for (const parentId of [null, tool.id]) {
		for (const kind of ['thread.title', 'plugin.storage']) {
			const receipt = await f.insert({ parentId, label: kind, binding: { kind } });
			assert.equal(await activity.get(1, f.scope.appId, f.scope.runId, receipt.id), null);
			assert.equal((await f.model.get(f.scope, receipt.callerId, receipt.operationKey)).id, receipt.id);
		}
	}
	const page = await activity.list(1, f.scope.appId, run.thread_id, null, 20);
	assert.deepEqual(
		page.items.map((item) => item.operation.id),
		[tool.id],
	);
	assert.deepEqual(
		page.items[0].effects.map((item) => item.id),
		[native.id],
	);
	assert.deepEqual((await activity.get(1, f.scope.appId, f.scope.runId, tool.id)).effects, page.items[0].effects);
});

async function fixture(t) {
	const f = await operationStorageFixture(t);
	const artifactId = randomUUID(),
		forgedArtifactId = randomUUID();
	const sourceText = JSON.stringify({ output: '甲🙂\n"\\'.repeat(40), artifactId: forgedArtifactId });
	const source = await f.insert({
		kind: 'tool',
		label: 'fixture.results.capture',
		capabilities: ['file.read'],
		text: sourceText,
	});
	const first = await f.insert({ parentId: source.id, target: { id: 11, version: 3 } });
	const second = await f.insert({ parentId: source.id, target: { id: 12, version: 4 } });
	const delivery = await f.insert({
		parentId: source.id,
		label: 'remote.deliver',
		target: { id: 11, version: 3 },
		capabilities: ['artifacts.write'],
	});
	await f.db.run('INSERT INTO agent_artifacts VALUES(?,1,?,1,?,?,1)', [
		artifactId,
		f.scope.appId,
		contentHash('ready'),
		5,
	]);
	await f.model.confirmArtifacts(delivery, [artifactId]);
	let policy = {
		userId: f.scope.userId,
		appId: f.scope.appId,
		revision: 1,
		executionVersion: 1,
		app: {
			enabled: true,
			declared: true,
			capabilities: ['plugin.invoke', 'file.read', 'context.read', 'artifacts.write'],
			deniedTargetIds: [],
		},
		grants: ['plugin.invoke', 'file.read', 'context.read', 'artifacts.write'].map((capability) => ({
			capability,
			schemaVersion: 2,
			grantedAt: 1,
			scope:
				capability === 'file.read'
					? { kind: 'targets', targets: { ssh: { mode: 'ids', ids: ['11', '12'] } } }
					: { kind: 'global' },
		})),
		overrides: {},
	};
	let connectionIds = [11, 12];
	const versions = new Map([
		[11, 3],
		[12, 4],
	]);
	let queries = 0;

	let beforeRead = async () => {};

	const service = new ResultService(
		f.model,
		{
			text: async (...args) => {
				await beforeRead();
				return f.contents.text(...args);
			},
		},
		{
			operationAuthority: async (userId, appId, runId) => {
				assert.deepEqual([userId, appId, runId], [f.scope.userId, f.scope.appId, f.scope.runId]);
				queries++;
				return { policy: structuredClone(policy), connectionIds: [...connectionIds] };
			},
		},
		{ target: async (id) => ({ id, version: versions.get(id) }) },
	);
	const reader = { ...f.scope, id: randomUUID(), operationHash: contentHash('reader') };
	const input = { toolCallId: source.id, sha256: contentHash(sourceText), offset: 0, maxBytes: 80 };
	return {
		...f,
		source,
		first,
		second,
		delivery,
		reader,
		input,
		sourceText,
		artifactId,
		forgedArtifactId,

		read: (value = input, actor = reader, abort = signal) => service.read(value, actor, 1, 8192, abort),

		setPolicy: (change) => {
			policy = change(structuredClone(policy));
		},

		select: (ids) => {
			connectionIds = ids;
		},

		versions,

		beforeRead: (work) => {
			beforeRead = work;
		},

		queries: () => queries,
	};
}

await test('Result sources: historical completed receipts retain real descendant targets, immutable content and trusted artifact evidence', async (t) => {
	const f = await fixture(t);
	await f.db.run("UPDATE agent_run_executions SET state='closed'");
	await f.db.run("UPDATE agent_runs SET status='completed'");
	const activity = await new SqliteOperationActivityStorage(f.db).get(1, f.scope.appId, f.scope.runId, f.source.id);
	assert.deepEqual(activity.outputArtifactIds, [f.artifactId]);
	assert.ok(
		!activity.outputArtifactIds.includes(f.forgedArtifactId),
		'Untrusted package text cannot manufacture artifact provenance',
	);
	const evidence = await f.model.evidence(f.scope, f.source.id);
	assert.equal(evidence.length, 4);
	assert.ok(
		evidence.every((entry) => !('resultText' in entry)),
		'No duplicate legacy result-body projection',
	);
	let offset = 0,
		captured = '';
	for (;;) {
		const { page, targets } = await f.read({ ...f.input, offset });
		assert.deepEqual(
			targets.sort((a, b) => a.id - b.id),
			[
				{ id: 11, version: 3 },
				{ id: 12, version: 4 },
			],
		);
		assert.equal(page.sha256, contentHash(f.sourceText));
		assert.equal(
			page.text,
			Array.from(f.sourceText)
				.slice(offset, page.nextOffset ?? undefined)
				.join(''),
		);
		captured += page.text;
		if (page.nextOffset === null) break;
		assert.ok(page.nextOffset > offset);
		offset = page.nextOffset;
	}
	assert.equal(captured, f.sourceText);
	assert.ok(f.queries() >= 4, 'Each page rechecks authority before and after reading');
});

await test('Result sources: current source, additional capability, target selection and version are reauthorized', async (t) => {
	for (const [name, change, code] of [
		[
			'source grant revoked',
			(f) => f.setPolicy((p) => ({ ...p, grants: p.grants.filter((g) => g.capability !== 'file.read') })),
			'forbidden',
		],
		[
			'artifact capability revoked',
			(f) => f.setPolicy((p) => ({ ...p, grants: p.grants.filter((g) => g.capability !== 'artifacts.write') })),
			'forbidden',
		],
		[
			'reader grant revoked',
			(f) => f.setPolicy((p) => ({ ...p, grants: p.grants.filter((g) => g.capability !== 'context.read') })),
			'version_conflict',
		],
		['App disabled', (f) => f.setPolicy((p) => ({ ...p, app: { ...p.app, enabled: false } })), 'version_conflict'],
		[
			'source target denied',
			(f) => f.setPolicy((p) => ({ ...p, app: { ...p.app, deniedTargetIds: [11] } })),
			'forbidden',
		],
		['source target deselected', (f) => f.select([12]), 'version_conflict'],
		['target revision changed', (f) => f.versions.set(11, 5), 'version_conflict'],
		['policy revision changed', (f) => f.setPolicy((p) => ({ ...p, revision: 2 })), 'version_conflict'],
	])
		await t.test(name, async (st) => {
			const f = await fixture(st);
			await change(f);
			const before = await f.db.all('SELECT * FROM agent_operations ORDER BY sequence');
			await assert.rejects(() => f.read(), refused(code));
			assert.deepEqual(
				await f.db.all('SELECT * FROM agent_operations ORDER BY sequence'),
				before,
				'Denied reads never rewrite original evidence',
			);
		});
});

await test('Result sources: a targetless Registry parent uses only its own capability-bearing descendants', async (t) => {
	for (const branch of ['unrelated sibling', 'different capability', 'no child'])
		await t.test(branch, async (st) => {
			const f = await fixture(st);
			const parent = await f.insert({
				kind: 'tool',
				label: 'fixture.results.isolated',
				capabilities: ['file.read'],
				text: '{"safe":true}',
			});
			if (branch === 'unrelated sibling') await f.insert({ target: { id: 11, version: 3 } });
			if (branch === 'different capability')
				await f.insert({ parentId: parent.id, capability: 'artifacts.write', target: { id: 11, version: 3 } });
			await assert.rejects(
				() => f.read({ ...f.input, toolCallId: parent.id, sha256: contentHash('{"safe":true}') }),
				refused('forbidden'),
			);
		});
	const f = await fixture(t);
	f.setPolicy((p) => ({
		...p,
		grants: p.grants.map((g) =>
			g.capability === 'file.read'
				? { ...g, scope: { kind: 'targets', targets: { ssh: { mode: 'ids', ids: ['11'] } } } }
				: g,
		),
	}));
	await assert.rejects(
		() => f.read(),
		refused('forbidden'),
		'Authorization for one child never authorizes another target',
	);
});

await test('Result sources: hash and Unicode cursor validation do not rerun handlers or mutate receipts', async (t) => {
	const f = await fixture(t);
	const before = await f.db.all('SELECT * FROM agent_operations ORDER BY sequence');
	for (const input of [
		{ ...f.input, sha256: 'f'.repeat(64) },
		{ ...f.input, offset: 999999 },
		{ ...f.input, offset: -1 },
		{ ...f.input, maxBytes: 65537 },
	])
		await assert.rejects(() => f.read(input), refused('invalid_input'));
	assert.deepEqual(await f.db.all('SELECT * FROM agent_operations ORDER BY sequence'), before);
});

await test('Result sources: different Run/App/user, self reads and incomplete or recursive native sources are refused', async (t) => {
	const f = await fixture(t);
	for (const actor of [
		{ ...f.reader, runId: randomUUID() },
		{ ...f.reader, appId: randomUUID() },
		{ ...f.reader, userId: 2 },
		{ ...f.reader, id: f.source.id },
	])
		await assert.rejects(() => f.read(f.input, actor), refused('not_found'));
	for (const state of ['accepted', 'dispatched', 'failed', 'cancelled', 'unknown']) {
		const source = await f.insert({ state });
		await assert.rejects(() => f.read({ ...f.input, toolCallId: source.id }), refused('not_found'));
	}
	const recursive = await f.insert({ label: 'context.readResults', capability: 'context.read' });
	await assert.rejects(
		() => f.read({ ...f.input, toolCallId: recursive.id, sha256: contentHash('{}') }),
		refused('not_found'),
	);
});

await test('Result sources: authority proof loss and changes during content delivery prevent publication', async (t) => {
	for (const duringRead of [false, true])
		await t.test(duringRead ? 'revoke while reading' : 'missing committed dispatch proof', async (st) => {
			const f = await fixture(st);
			if (duringRead) f.beforeRead(async () => f.setPolicy((p) => ({ ...p, revision: 2 })));
			else await f.db.run('DELETE FROM agent_operation_authorities WHERE operation_id=?', [f.first.id]);
			await assert.rejects(() => f.read(), refused('version_conflict'));
		});
	const f = await fixture(t);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		() => f.read(f.input, f.reader, controller.signal),
		(error) => error === controller.signal.reason,
	);
});

await test('Result sources: corrupted content chunks, missing chunks and forged complete hashes cannot be delivered', async (t) => {
	for (const mode of ['bytes changed', 'metadata changed', 'whole hash changed', 'chunk missing'])
		await t.test(mode, async (st) => {
			const f = await fixture(st);
			const ref = JSON.parse(f.source.resultJson).content;
			if (mode === 'bytes changed')
				await f.db.run("UPDATE agent_operation_content_chunks SET text='corrupt' WHERE content_id=?", [ref.id]);
			if (mode === 'metadata changed')
				await f.db.run('UPDATE agent_operation_content_chunks SET size_bytes=size_bytes+1 WHERE content_id=?', [
					ref.id,
				]);
			if (mode === 'whole hash changed') {
				const changed = f.sourceText.replace('甲', '乙');
				await f.db.run(
					'UPDATE agent_operation_content_chunks SET text=?,sha256=?,size_bytes=? WHERE content_id=?',
					[changed, contentHash(changed), Buffer.byteLength(changed), ref.id],
				);
			}
			if (mode === 'chunk missing')
				await f.db.run('DELETE FROM agent_operation_content_chunks WHERE content_id=?', [ref.id]);
			await assert.rejects(() => f.read(), refused(mode === 'chunk missing' ? 'not_found' : 'internal_failure'));
		});
});

await test('Result sources: late ready artifact evidence survives unknown operation state and is idempotent', async (t) => {
	const f = await fixture(t);
	const child = await f.insert({
		state: 'unknown',
		parentId: f.source.id,
		label: 'artifacts.present',
		capability: 'artifacts.read',
	});
	const before = await f.model.get(f.scope, child.callerId, child.operationKey);
	await f.model.confirmArtifacts(child, [f.artifactId]);
	await f.model.confirmArtifacts(child, [f.artifactId]);
	assert.deepEqual(
		await f.model.get(f.scope, child.callerId, child.operationKey),
		before,
		'Late evidence preserves terminal state, hash and revision',
	);
	const activity = await new SqliteOperationActivityStorage(f.db).get(1, f.scope.appId, f.scope.runId, f.source.id);
	assert.deepEqual(activity.outputArtifactIds, [f.artifactId]);
	assert.equal(
		(await f.db.all('SELECT * FROM agent_operation_artifacts WHERE operation_id=?', [child.id])).length,
		1,
	);
});

await test('Result sources: late artifact evidence rejects foreign identity, readiness, hash and owner without writes', async (t) => {
	for (const mode of [
		'foreign user',
		'foreign App',
		'not ready',
		'wrong request hash',
		'accepted owner',
		'changed immutable artifact',
	])
		await t.test(mode, async (st) => {
			const f = await fixture(st);
			let owner = f.delivery;
			if (mode === 'foreign user')
				await f.db.run('UPDATE agent_artifacts SET user_id=2 WHERE id=?', [f.artifactId]);
			if (mode === 'foreign App')
				await f.db.run('UPDATE agent_artifacts SET app_id=? WHERE id=?', [randomUUID(), f.artifactId]);
			if (mode === 'not ready')
				await f.db.run('UPDATE agent_artifacts SET ready_at=NULL WHERE id=?', [f.artifactId]);
			if (mode === 'wrong request hash') owner = { ...owner, requestHash: 'f'.repeat(64) };
			if (mode === 'accepted owner') owner = await f.insert({ state: 'accepted' });
			if (mode === 'changed immutable artifact')
				await f.db.run('UPDATE agent_artifacts SET sha256=? WHERE id=?', ['f'.repeat(64), f.artifactId]);
			const before = await f.db.all('SELECT * FROM agent_operation_artifacts ORDER BY operation_id');
			await assert.rejects(() => f.model.confirmArtifacts(owner, [f.artifactId]), refused('internal_failure'));
			assert.deepEqual(await f.db.all('SELECT * FROM agent_operation_artifacts ORDER BY operation_id'), before);
		});
});

await test('Result sources: a result larger than the old whole-response ceiling still supports exact bounded continuation', async (t) => {
	const f = await fixture(t);
	const original = '甲🙂'.repeat(310000) + 'complete-tail';
	assert.ok(Buffer.byteLength(original) > 2 * 1024 * 1024);
	const source = await f.insert({ kind: 'tool', label: 'fixture.results.large', capabilities: [], text: original });
	const input = { toolCallId: source.id, sha256: contentHash(original), offset: 0, maxBytes: 4096 };
	const first = await f.read(input);
	assert.ok(first.page.nextOffset > 0);
	assert.equal(first.page.originalBytes, Buffer.byteLength(original));
	const second = await f.read({ ...input, offset: first.page.nextOffset });
	assert.equal(first.page.text + second.page.text, Array.from(original).slice(0, second.page.nextOffset).join(''));
	const finalOffset = Array.from(original).length - 20;
	const tail = await f.read({ ...input, offset: finalOffset });
	assert.equal(tail.page.nextOffset, null);
	assert.equal(tail.page.text, Array.from(original).slice(finalOffset).join(''));
	assert.ok(Buffer.byteLength(JSON.stringify(tail.page)) < 8192);
});
