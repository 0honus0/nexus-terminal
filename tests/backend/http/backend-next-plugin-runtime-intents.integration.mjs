import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPlugins } from './plugin-management-fixture.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';

// This signed test program consumes host SDK only; no application runtime or SQL is replaced.
const backend = `let timer, running = Promise.resolve(), stopped = false, busy = false, seen = null;
export async function activate({ request }) {
 async function tick() {
  if (stopped) return;
  const command = await request({ method: 'storage.get', params: { key: 'command' } });
  if (!command.ok || !command.result.value?.valueJson) return;
  const input = JSON.parse(command.result.value.valueJson);
  if (input.id === seen) return;
  seen = input.id;
  const reply = await request(input.request);
  const previous = await request({ method: 'storage.get', params: { key: 'reply' } });
  if (!previous.ok) return;
  const saved = await request({ method: 'storage.put', params: { key: 'reply', expectedVersion: previous.result.value?.version ?? 0, operationId: crypto.randomUUID(), valueJson: JSON.stringify({ id: input.id, reply }) } });
  if (!saved.ok) throw new Error('fixture reply persistence failed');
 }
 const schedule = () => {
  if (busy || stopped) return;
  busy = true;
  running = tick().finally(() => { busy = false; });
  running.catch(() => { stopped = true; clearInterval(timer); });
 };
 timer = setInterval(schedule, 50);
 schedule();
}
export function health() { return !stopped; }
export async function quiesce() { stopped = true; clearInterval(timer); await running; }
export async function dispose() { stopped = true; clearInterval(timer); await running; }
`;

await test('B10 real child-process SDK intents and Artifact authorization', { timeout: 60000 }, async (t) => {
	const f = await openPlugins(t);
	const capabilities = ['app.intents.exchange', 'artifacts.read'];
	const sender = await f.install('runtime-sender', { backend, capabilities, enabled: false });
	const receiver = await f.install('runtime-receiver', {
		backend,
		capabilities,
		enabled: false,
		intents: [{ id: 'inspect', schemaVersion: 1 }],
	});
	await receiver.grants(capabilities);
	await sender.enabled(true);
	await receiver.enabled(true);

	const installPath = (plugin) => '/api/v1/agent/plugins/installations/' + plugin.appId;

	const dataPath = (plugin, key) => installPath(plugin) + '/data/' + key;

	const data = async (plugin, key) => expectStatus(await f.api('GET', dataPath(plugin, key)), 200).value;

	const runtime = async (plugin) => expectStatus(await f.api('GET', installPath(plugin) + '/runtime'), 200);

	async function command(plugin, request) {
		const id = randomUUID();
		const previous = await data(plugin, 'command');
		expectStatus(
			await f.api('PUT', dataPath(plugin, 'command'), {
				expectedRevision: plugin.installation.revision,
				expectedVersion: previous?.version ?? 0,
				operationId: id,
				valueJson: JSON.stringify({ id, request }),
			}),
			200,
		);
		const result = await until(
			async () => {
				const current = await data(plugin, 'reply');
				return current?.valueJson ? JSON.parse(current.valueJson) : null;
			},
			(value) => value?.id === id,
			'real child SDK reply',
		);
		return result.reply;
	}

	const content = Buffer.concat([Buffer.from('runtime\0共享'), randomBytes(4096)]);
	const artifact = await f.upload(sender.appId, content, 'runtime.bin');
	const unrelated = await f.upload(sender.appId, Buffer.from('not granted'), 'private.bin');
	const input = {
		operationId: randomUUID(),
		receiverAppId: receiver.appId,
		intentId: 'inspect',
		inputJson: '{"runtime":true}',
		artifactIds: [artifact.id],
		confirmed: true,
	};

	const create = (params = input) => command(sender, { method: 'intents.create', params });

	const list = () => command(receiver, { method: 'intents.listReceived', params: { limit: 50 } });

	let receipt;
	let identities;
	await t.test(
		'two actual native child instances are active with independently observed process identities',
		async () => {
			assert.equal((await runtime(sender)).state, 'active');
			assert.equal((await runtime(receiver)).state, 'active');
			const root = f.database + '.modules';
			identities = await Promise.all(
				(await readdir(root)).map(async (name) => {
					const journal = JSON.parse(await readFile(join(root, name, '.nexus-process.json'), 'utf8'));
					assert.equal(journal.parent.pid, process.pid);
					assert.notEqual(journal.child.pid, process.pid);
					const args = await readFile('/proc/' + journal.child.pid + '/cmdline', 'utf8');
					assert.ok(args.split('\0').includes(join(root, name, '.nexus-runtime.mjs')));
					return journal.child;
				}),
			);
			assert.equal(identities.length, 2);
			assert.notEqual(identities[0].pid, identities[1].pid);
		},
	);
	await t.test('active runtime without sender grant cannot create a receipt', async () => {
		assert.deepEqual(await create(), { ok: false, error: { code: 'forbidden' } });
		assert.deepEqual((await list()).result.value, []);
	});
	await t.test('runtime host identity is assigned by its actual installation', async () => {
		const reply = await command(sender, { method: 'host.appInfo', params: {} });
		assert.deepEqual(reply, { ok: true, result: { method: 'host.appInfo', value: sender.installation } });
	});
	await t.test('runtime storage create, get and delete preserve independent key CAS and tombstone', async () => {
		const written = await command(sender, {
			method: 'storage.put',
			params: { key: 'scratch', expectedVersion: 0, operationId: randomUUID(), valueJson: 'null' },
		});
		assert.equal(written.ok, true);
		assert.equal(written.result.value.valueJson, 'null');
		assert.deepEqual(
			(await command(sender, { method: 'storage.get', params: { key: 'scratch' } })).result.value,
			written.result.value,
		);
		const removed = await command(sender, {
			method: 'storage.delete',
			params: { key: 'scratch', expectedVersion: written.result.value.version, operationId: randomUUID() },
		});
		assert.equal(removed.ok, true);
		assert.equal(removed.result.value.valueJson, null);
		assert.equal(removed.result.value.version, written.result.value.version + 1);
	});
	await t.test('current runtime grants authorize a real receipt and original operation replay', async () => {
		await sender.grants(capabilities);
		const first = await create();
		assert.equal(first.ok, true);
		receipt = first.result.value;
		assert.equal(receipt.id, input.operationId);
		assert.equal(receipt.senderAppId, sender.appId);
		assert.equal(receipt.receiverAppId, receiver.appId);
		assert.deepEqual(await create(), first);
		assert.deepEqual((await list()).result.value, [receipt]);
	});
	await t.test('changed content with original operation ID returns explicit conflict', async () => {
		assert.deepEqual(await create({ ...input, inputJson: '"changed"' }), {
			ok: false,
			error: { code: 'version_conflict' },
		});
		assert.deepEqual((await list()).result.value, [receipt]);
	});
	await t.test('runtime Artifact metadata and range preserve exact identity, version, hash and bytes', async () => {
		const metadata = await command(receiver, {
			method: 'intents.artifacts.get',
			params: { receiptId: receipt.id, artifactId: artifact.id },
		});
		assert.equal(metadata.ok, true);
		assert.equal(metadata.result.value.id, artifact.id);
		assert.equal(metadata.result.value.version, artifact.version);
		assert.equal(metadata.result.value.sha256, createHash('sha256').update(content).digest('hex'));
		const range = await command(receiver, {
			method: 'intents.artifacts.readRange',
			params: { receiptId: receipt.id, artifactId: artifact.id, start: 1, endInclusive: content.length - 2 },
		});
		assert.equal(range.ok, true);
		assert.equal(range.result.value.receiptId, receipt.id);
		assert.equal(range.result.value.artifactId, artifact.id);
		assert.deepEqual(Buffer.from(range.result.value.dataBase64, 'base64'), content.subarray(1, -1));
	});
	await t.test('runtime receipt does not grant unrelated source bytes or sender-side reads', async () => {
		for (const [plugin, artifactId] of [
			[receiver, unrelated.id],
			[sender, artifact.id],
		]) {
			assert.deepEqual(
				await command(plugin, {
					method: 'intents.artifacts.get',
					params: { receiptId: receipt.id, artifactId },
				}),
				{ ok: false, error: { code: 'not_found' } },
			);
		}
	});
	await t.test('runtime receipt protects source deletion, receiver cannot revoke it', async () => {
		expectStatus(
			await f.api('DELETE', sender.appPath + '/artifacts/' + artifact.id, { expectedVersion: artifact.version }),
			409,
		);
		assert.deepEqual(await command(receiver, { method: 'intents.revoke', params: { receiptId: receipt.id } }), {
			ok: false,
			error: { code: 'not_found' },
		});
	});
	await t.test('runtime sender revoke removes list and range access and releases deletion protection', async () => {
		assert.deepEqual(await command(sender, { method: 'intents.revoke', params: { receiptId: receipt.id } }), {
			ok: true,
			result: { method: 'intents.revoke', value: { revoked: true } },
		});
		assert.deepEqual((await list()).result.value, []);
		assert.deepEqual(
			await command(receiver, {
				method: 'intents.artifacts.readRange',
				params: { receiptId: receipt.id, artifactId: artifact.id, start: 0, endInclusive: 1 },
			}),
			{ ok: false, error: { code: 'not_found' } },
		);
		expectStatus(
			await f.api('DELETE', sender.appPath + '/artifacts/' + artifact.id, { expectedVersion: artifact.version }),
			200,
		);
	});
	await t.test('grant revision invalidates live receipt and regrant cannot revive it', async () => {
		const next = { ...input, operationId: randomUUID(), artifactIds: [] };
		const current = (await create(next)).result.value;
		await sender.grants([]);
		assert.deepEqual((await list()).result.value, []);
		assert.deepEqual(await create({ ...next, operationId: randomUUID() }), {
			ok: false,
			error: { code: 'forbidden' },
		});
		await sender.grants(capabilities);
		assert.deepEqual((await list()).result.value, []);
		assert.deepEqual(await create(next), { ok: false, error: { code: 'not_found' } });
		assert.equal((await command(sender, { method: 'intents.revoke', params: { receiptId: current.id } })).ok, true);
	});
	await t.test('controlled shutdown waits original children and removes materialized directories', async () => {
		await sender.enabled(false);
		await receiver.enabled(false);
		assert.equal((await runtime(sender)).state, 'closed');
		assert.equal((await runtime(receiver)).state, 'closed');
		assert.deepEqual(await readdir(f.database + '.modules'), []);
		for (const identity of identities) {
			try {
				const stat = await readFile('/proc/' + identity.pid + '/stat', 'utf8');
				assert.notEqual(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19], identity.started);
			} catch (error) {
				if (error.code !== 'ENOENT') throw error;
			}
		}
	});
});
