import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { openPlugins } from './plugin-management-fixture.mjs';
import { holdBlobOpen } from './blob-lease-fixture.mjs';
import { expectStatus } from '../remote/openssh-fixture.mjs';

const capabilities = ['app.intents.exchange', 'artifacts.read'];

async function setup(t) {
	const f = await openPlugins(t);
	const sender = await f.install('race-sender', { capabilities });
	const receiver = await f.install('race-receiver', {
		capabilities,
		intents: [{ id: 'inspect', schemaVersion: 1 }],
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
				protocol: 4,
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
	assert.equal(body.protocol, 4);
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
