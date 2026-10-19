import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { processIdentity } from '../../../packages/backend/dist/platform/isolation/adapters/module-recovery.js';
import { openPlugins } from './plugin-management-fixture.mjs';
import { holdBlobOpen } from './blob-lease-fixture.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';

const capabilities = ['app.intents.exchange', 'artifacts.read'];

// A real signed plugin polls its own command key and persists replies through host SDK.
// During quiesce, even a successful late byte reply must fail the lifecycle assertion.
const backend = `let timer, running = Promise.resolve(), stopped = false, busy = false, seen, failure;
export function activate({request}) {
 async function tick() {
  const command = await request({ method:'storage.get', params:{key:'command'} });
  if (stopped || !command.ok || !command.result.value?.valueJson) return;
  const input = JSON.parse(command.result.value.valueJson);
  if (!input || input.id === seen) return;
  seen = input.id;
  const reply = await request(input.request);
  if (stopped) {
   if (reply.ok) throw new Error('bytes delivered to a closing runtime');
   return;
  }
  const previous = await request({method:'storage.get',params:{key:'reply'}});
  if (stopped) return;
  if (!previous.ok) throw new Error('reply read failed');
  const saved = await request({method:'storage.put',params:{key:'reply',expectedVersion:previous.result.value?.version ?? 0,operationId:crypto.randomUUID(),valueJson:JSON.stringify({id:input.id,reply})}});
  if (!saved.ok) throw new Error('reply write failed');
 }
 const schedule = () => {
  if (busy || stopped) return;
  busy = true;
  running = tick().catch(error => { failure=error; stopped=true; clearInterval(timer); }).finally(() => {busy=false;});
 };
 timer=setInterval(schedule,30); schedule();
}
export function health() { return !failure; }
export async function quiesce() { stopped=true; clearInterval(timer); await running; if(failure) throw failure; }
export async function dispose() { stopped=true; clearInterval(timer); await running; if(failure) throw failure; }
`;

async function setup(t, native = false) {
	const f = await openPlugins(t);
	const sender = await f.install('race-sender', { capabilities });
	const receiver = await f.install('race-receiver', {
		capabilities,
		intents: [{ id: 'inspect', schemaVersion: 1 }],
		...(native ? { backend } : {}),
	});
	await sender.grants(capabilities);
	await receiver.grants(capabilities);
	const bytes = randomBytes(4096);
	const artifact = await f.upload(sender.appId, bytes, 'in-flight.bin');
	const installPath = '/api/v1/agent/plugins/installations/' + receiver.appId;

	const read = (receipt) => ({
		method: 'intents.artifacts.readRange',
		params: { receiptId: receipt.id, artifactId: artifact.id, start: 1, endInclusive: 127 },
	});

	return {
		f,
		sender,
		receiver,
		artifact,
		bytes,
		installPath,
		read,

		async receipt() {
			return expectStatus(
				await f.api('POST', sender.appPath + '/plugin-intents', {
					operationId: randomUUID(),
					receiverAppId: receiver.appId,
					intentId: 'inspect',
					inputJson: '{}',
					artifactIds: [artifact.id],
					confirmed: true,
				}),
				201,
			).receipt;
		},

		async rpc(receipt) {
			const descriptor = expectStatus(await f.api('GET', installPath + '/descriptor'), 200);
			const envelope = {
				type: 'nexus.plugin.request',
				protocol: 1,
				nonce: randomUUID(),
				id: randomUUID(),
				seq: 1,
				request: read(receipt),
			};
			return {
				envelope,

				send: () =>
					f.api('POST', installPath + '/frontend/rpc', { grant: descriptor.url.split('/')[4], envelope }),
			};
		},
	};
}

function assertReply(response, envelope, status, code) {
	const body = expectStatus(response, status);
	assert.equal(body.type, 'nexus.plugin.response');
	assert.equal(body.protocol, 1);
	assert.equal(body.id, envelope.id);
	assert.equal(body.nonce, envelope.nonce);
	assert.equal(body.seq, envelope.seq);
	assert.equal(body.ok, false);
	assert.deepEqual(body.error, { code });
	assert.equal(Object.hasOwn(body, 'result'), false, 'failed RPC never publishes partial bytes');
}

function observe(t, promise) {
	const settled = Promise.allSettled([promise]);
	t.after(async () => {
		const [result] = await settled;
		if (result.status === 'rejected') throw result.reason;
	});
	return settled;
}

await test(
	'B10 actual HTTP RPC authorization changes after a kernel-confirmed Blob open',
	{ timeout: 60000 },
	async (t) => {
		const s = await setup(t);
		const { f, sender, receiver, artifact } = s;
		await t.test('unchanged authority returns exact bytes after the real blocked open is released', async (t) => {
			const receipt = await s.receipt();
			const rpc = await s.rpc(receipt);
			const lease = await holdBlobOpen(t, f, artifact);
			const pending = rpc.send();
			const observed = observe(t, pending);
			await lease.blocked();
			await lease.release();
			const [result] = await observed;
			assert.equal(result.status, 'fulfilled');
			const body = expectStatus(result.value, 200);
			assert.equal(body.ok, true);
			assert.equal(body.result.value.receiptId, receipt.id);
			assert.deepEqual(Buffer.from(body.result.value.dataBase64, 'base64'), s.bytes.subarray(1, 128));
		});
		for (const [label, change, restore] of [
			['sender grant', () => sender.grants([]), () => sender.grants(capabilities)],
			['receiver grant', () => receiver.grants([]), () => receiver.grants(capabilities)],
			['sender disable', () => sender.enabled(false), () => sender.enabled(true)],
			['receiver disable', () => receiver.enabled(false), () => receiver.enabled(true)],
			[
				'receipt revoke',
				(receipt) =>
					f
						.api('DELETE', sender.appPath + '/plugin-intents/' + receipt.id, {})
						.then((r) => expectStatus(r, 200)),
				async () => {},
			],
		]) {
			await t.test(label + ' rejects the already dispatched RPC and cannot revive the old receipt', async (t) => {
				const receipt = await s.receipt();
				const rpc = await s.rpc(receipt);
				const lease = await holdBlobOpen(t, f, artifact);
				const pending = rpc.send();
				const observed = observe(t, pending);
				await lease.blocked();
				await change(receipt);
				await lease.release();
				const [result] = await observed;
				assert.equal(result.status, 'fulfilled');
				assertReply(result.value, rpc.envelope, 404, 'not_found');
				await restore();
				const fresh = await s.rpc(receipt);
				assertReply(await fresh.send(), fresh.envelope, 404, 'not_found');
			});
		}
		await t.test(
			'logout while real Blob open waits rejects delivery and fresh login retains valid receipt',
			async (t) => {
				const receipt = await s.receipt();
				const rpc = await s.rpc(receipt);
				const lease = await holdBlobOpen(t, f, artifact);
				const observed = observe(t, rpc.send());
				await lease.blocked();
				expectStatus(await f.api('POST', '/api/v1/auth/logout', {}), 200);
				await lease.release();
				const [result] = await observed;
				assert.equal(result.status, 'fulfilled');
				assertReply(result.value, rpc.envelope, 401, 'unauthenticated');
				await f.login();
				const fresh = await s.rpc(receipt);
				assert.equal(expectStatus(await fresh.send(), 200).ok, true);
			},
		);
		await t.test(
			'Artifact version change invalidates the old grant; a new receipt reads unchanged bytes',
			async (t) => {
				const receipt = await s.receipt();
				const rpc = await s.rpc(receipt);
				const lease = await holdBlobOpen(t, f, artifact);
				const observed = observe(t, rpc.send());
				await lease.blocked();
				const updated = expectStatus(
					await f.api('PATCH', sender.appPath + '/artifacts/' + artifact.id + '/retain', {
						expectedVersion: artifact.version,
						retained: true,
					}),
					200,
				).artifact;
				assert.ok(updated.version > artifact.version);
				artifact.version = updated.version;
				await lease.release();
				const [result] = await observed;
				assert.equal(result.status, 'fulfilled');
				assertReply(result.value, rpc.envelope, 404, 'not_found');
				const old = await s.rpc(receipt);
				assertReply(await old.send(), old.envelope, 404, 'not_found');
				const fresh = await s.rpc(await s.receipt());
				const body = expectStatus(await fresh.send(), 200);
				assert.deepEqual(Buffer.from(body.result.value.dataBase64, 'base64'), s.bytes.subarray(1, 128));
			},
		);
	},
);

await test('B10 actual backend SDK revocation and original-child upgrade drain', { timeout: 60000 }, async (t) => {
	const s = await setup(t, true);
	const { f, sender, receiver, artifact, installPath } = s;
	const db = new DatabaseSync(f.database, { readOnly: true });
	t.after(() => db.close());

	const stored = (key) =>
		db.prepare('SELECT value_json FROM agent_plugin_data WHERE app_id=? AND key=?').get(receiver.appId, key)
			?.value_json;

	const current = () => db.prepare('SELECT * FROM agent_plugin_runtime_instances WHERE app_id=?').get(receiver.appId);

	async function command(receipt) {
		const old = expectStatus(await f.api('GET', installPath + '/data/command'), 200).value;
		const id = randomUUID();
		expectStatus(
			await f.api('PUT', installPath + '/data/command', {
				expectedRevision: receiver.installation.revision,
				expectedVersion: old?.version ?? 0,
				operationId: randomUUID(),
				valueJson: JSON.stringify({ id, request: s.read(receipt) }),
			}),
			200,
		);
		return id;
	}

	async function reply(id) {
		return until(
			() => {
				const value = stored('reply');
				return value ? JSON.parse(value) : null;
			},
			(value) => value?.id === id,
			'actual child SDK reply persisted',
		);
	}

	async function child() {
		const root = f.database + '.modules';
		const names = await readdir(root);
		assert.equal(names.length, 1);
		const journal = JSON.parse(await readFile(join(root, names[0], '.nexus-process.json'), 'utf8'));
		assert.equal(journal.parent.pid, process.pid);
		assert.deepEqual(await processIdentity(journal.child.pid), journal.child);
		const args = (await readFile('/proc/' + journal.child.pid + '/cmdline', 'utf8')).split('\0');
		assert.ok(args.includes(join(root, names[0], '.nexus-runtime.mjs')));
		return journal.child;
	}

	for (const [label, change, restore] of [
		['sender grant', () => sender.grants([]), () => sender.grants(capabilities)],
		['receiver grant', () => receiver.grants([]), () => receiver.grants(capabilities)],
		['sender disable', () => sender.enabled(false), () => sender.enabled(true)],
		[
			'receipt revoke',
			(receipt) =>
				f.api('DELETE', sender.appPath + '/plugin-intents/' + receipt.id, {}).then((r) => expectStatus(r, 200)),
			async () => {},
		],
	]) {
		await t.test(label + ' rejects a kernel-confirmed native host read without stopping its owner', async (t) => {
			const receipt = await s.receipt();
			const before = current();
			const lease = await holdBlobOpen(t, f, artifact);
			const id = await command(receipt);
			await lease.blocked();
			await change(receipt);
			await lease.release();
			assert.deepEqual((await reply(id)).reply, { ok: false, error: { code: 'not_found' } });
			assert.equal(current().instance_id, before.instance_id);
			assert.equal(current().state, 'active');
			await restore();
			const valid = await s.receipt();
			const delivered = (await reply(await command(valid))).reply;
			assert.equal(delivered.ok, true);
			assert.deepEqual(Buffer.from(delivered.result.value.dataBase64, 'base64'), s.bytes.subarray(1, 128));
		});
	}
	await t.test('session logout does not revoke an independently authorized in-flight backend instance', async (t) => {
		const receipt = await s.receipt();
		const before = current();
		const lease = await holdBlobOpen(t, f, artifact);
		const id = await command(receipt);
		await lease.blocked();
		expectStatus(await f.api('POST', '/api/v1/auth/logout', {}), 200);
		await lease.release();
		const delivered = (await reply(id)).reply;
		assert.equal(delivered.ok, true);
		assert.deepEqual(Buffer.from(delivered.result.value.dataBase64, 'base64'), s.bytes.subarray(1, 128));
		assert.equal(current().instance_id, before.instance_id);
		expectStatus(await f.api('GET', installPath + '/runtime'), 401);
		await f.login();
	});
	await t.test('receiver disable waits the original read and reenable cannot revive its old receipt', async (t) => {
		const receipt = await s.receipt();
		const before = current();
		const originalChild = await child();
		const lease = await holdBlobOpen(t, f, artifact);
		const id = await command(receipt);
		await lease.blocked();
		let settled = false;
		const observed = observe(
			t,
			receiver.enabled(false).then((value) => {
				settled = true;
				return value;
			}),
		);
		await until(
			() => db.prepare('SELECT enabled FROM agent_apps WHERE id=?').get(receiver.appId).enabled,
			(value) => value === 0,
			'App disabled before original host finishes',
		);
		assert.equal(settled, false);
		await lease.release();
		const [result] = await observed;
		assert.equal(result.status, 'fulfilled');
		assert.equal(current().state, 'closed');
		assert.equal(await processIdentity(originalChild.pid), null);
		await receiver.enabled(true);
		assert.notEqual(current().instance_id, before.instance_id);
		assert.deepEqual((await reply(id)).reply, { ok: false, error: { code: 'not_found' } });
		const valid = await s.receipt();
		const delivered = (await reply(await command(valid))).reply;
		assert.equal(delivered.ok, true);
		assert.deepEqual(Buffer.from(delivered.result.value.dataBase64, 'base64'), s.bytes.subarray(1, 128));
	});
	await t.test(
		'upgrade waits the original host, refuses its late bytes and starts an independent new child',
		async (t) => {
			const packageArtifact = await f.upload(
				sender.appId,
				await f.build('race-receiver', {
					version: '1.1.0',
					capabilities,
					backend,
					intents: [{ id: 'inspect', schemaVersion: 1 }],
				}),
			);
			const stage = expectStatus(
				await f.api('POST', '/api/v1/agent/plugins/stage', {
					artifactAppId: sender.appId,
					artifactId: packageArtifact.id,
					expectedVersion: packageArtifact.version,
				}),
				200,
			);
			const verified = expectStatus(
				await f.api('POST', '/api/v1/agent/plugins/verify', {
					stageId: stage.id,
					expectedVersion: stage.version,
				}),
				200,
			);
			const receipt = await s.receipt();
			const before = current();
			const originalChild = await child();
			const lease = await holdBlobOpen(t, f, artifact);
			const id = await command(receipt);
			await lease.blocked();
			const input = {
				expectedRevision: receiver.installation.revision,
				stageId: verified.id,
				expectedStageVersion: verified.version,
			};
			let settled = false;
			const pending = f.api('POST', installPath + '/prepare-upgrade', input).then((result) => {
				settled = true;
				return result;
			});
			const observed = observe(t, pending);
			await until(
				() =>
					db.prepare('SELECT status FROM agent_plugin_installations WHERE app_id=?').get(receiver.appId)
						.status,
				(value) => value === 'draining',
				'upgrade committed draining before actual host finishes',
			);
			assert.equal(settled, false);
			assert.equal(current().instance_id, before.instance_id);
			await lease.release();
			const [outcome] = await observed;
			assert.equal(outcome.status, 'fulfilled');
			const prepared = expectStatus(outcome.value, 200);
			assert.equal(prepared.status, 'draining');
			assert.equal(current().state, 'closed');
			assert.equal(await processIdentity(originalChild.pid), null);
			const saved = stored('reply');
			assert.notEqual(saved ? JSON.parse(saved).id : null, id, 'closing runtime cannot publish a late reply');
			receiver.installation = expectStatus(
				await f.api('POST', installPath + '/upgrade', { ...input, expectedRevision: prepared.revision }),
				200,
			);
			assert.equal(receiver.installation.version, '1.1.0');
			await receiver.grants(capabilities);
			await receiver.enabled(true);
			assert.equal(current().state, 'active');
			assert.notEqual(current().instance_id, before.instance_id);
			assert.notDeepEqual(await child(), originalChild);
			assert.deepEqual((await reply(id)).reply, { ok: false, error: { code: 'not_found' } });
			const valid = await s.receipt();
			const delivered = (await reply(await command(valid))).reply;
			assert.equal(delivered.ok, true);
			assert.deepEqual(Buffer.from(delivered.result.value.dataBase64, 'base64'), s.bytes.subarray(1, 128));
			await receiver.enabled(false);
			assert.equal(current().state, 'closed');
		},
	);
});
