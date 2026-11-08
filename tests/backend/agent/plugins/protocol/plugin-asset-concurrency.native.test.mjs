import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NativeBlobStore } from '../../../../../packages/backend/dist/platform/blobs/adapters/native-blob-store.js';
import { PluginService } from '../../../../../packages/backend/dist/modules/agent/plugins/service/plugin-service.js';
import { openPlugins } from '../support/plugin-management-fixture.mjs';
import { expectStatus, until } from '../../../../support/protocols/openssh-fixture.mjs';

async function setup(t) {
	let owner;
	const descriptor = PluginService.prototype.descriptor;
	t.mock.method(PluginService.prototype, 'descriptor', function (...args) {
		owner = this;
		return descriptor.apply(this, args);
	});
	const f = await openPlugins((close) => t.after(close));
	const assets = Object.fromEntries(
		Array.from({ length: 16 }, (_, index) => [
			index % 2 ? 'font-' + index + '.woff2' : 'chunk-' + index + '.mjs',
			'signed asset bytes ' + index,
		]),
	);
	const plugin = await f.install('asset-concurrency', { assets });
	const view = expectStatus(
		await f.api('GET', '/api/v1/agent/plugins/installations/' + plugin.appId + '/descriptor'),
		200,
	);
	assert.ok(owner);

	const url = (name) => view.url.slice(0, view.url.lastIndexOf('/') + 1) + 'assets/' + name;

	const original = NativeBlobStore.prototype.read;
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	const gate = { entered: false, active: false, signal: null, release };
	t.mock.method(NativeBlobStore.prototype, 'read', async function* (...args) {
		let holding = false;
		try {
			for await (const chunk of original.apply(this, args)) {
				if (!gate.entered && args[0] === plugin.stage.id) {
					gate.entered = true;
					gate.active = true;
					gate.signal = args[2];
					holding = true;
					await held;
				}
				yield chunk;
			}
		} finally {
			if (holding) gate.active = false;
		}
	});
	return { f, plugin, view, assets, url, gate, owner };
}

await test(
	'Plugin asset concurrency: a real signed page with sixteen concurrent chunks and fonts never consumes the management command budget',
	{ timeout: 60000 },
	async (t) => {
		const { f, assets, url, gate, owner } = await setup(t);
		const pending = Object.keys(assets).map((name) => f.api('GET', url(name)));
		const settled = Promise.allSettled(pending);
		try {
			await until(() => gate.entered, Boolean, 'actual signed package file read is held');
			await until(
				() => owner.pending.size,
				(size) => size >= 16,
				'sixteen actual HTTP asset requests are owned',
			);
			expectStatus(await f.api('GET', '/api/v1/agent/plugins/packages'), 200);
			gate.release();
			const responses = await Promise.all(pending);
			responses.forEach((response, index) => {
				assert.equal(response.status, 200);
				assert.equal(response.bytes.toString(), Object.values(assets)[index]);
				assert.equal(response.headers['cache-control'], 'no-store');
			});
			assert.equal(gate.active, false);
		} finally {
			gate.release();
			await settled;
		}
	},
);

await test(
	'Plugin asset concurrency: invalid grant and path bursts reject before the held asset lane',
	{ timeout: 60000 },
	async (t) => {
		const { f, assets, url, gate, owner, plugin } = await setup(t);
		const pending = f.api('GET', url(Object.keys(assets)[0]));
		const observed = Promise.allSettled([pending]);
		try {
			await until(() => gate.entered, Boolean, 'one real package read holds the asset lane');
			const [grant, permission] = [...owner.contentGrants].find(([, value]) => value.appId === plugin.appId);
			assert.ok(url(Object.keys(assets)[0]).includes(grant));
			const before = owner.pending.size;
			const invalid = Array.from({ length: 32 }, (_, index) =>
				index % 2
					? f
							.api(
								'GET',
								url(Object.keys(assets)[0]).replace(grant, '00000000-0000-4000-8000-000000000000'),
							)
							.then((response) => {
								assert.equal(response.status, 403);
							})
					: assert.rejects(
							owner.asset(plugin.appId, permission.version, grant, 'frontend/../secret', async () => {
								assert.fail('invalid path must never deliver bytes');
							}),
							(error) => error.code === 'invalid_input',
						),
			);
			await Promise.all(invalid);
			assert.equal(gate.active, true, 'invalid requests settle while the real read remains held');
			assert.equal(owner.pending.size, before, 'invalid input never enters pending ownership or asset lane');
			gate.release();
			assert.equal((await pending).status, 200);
		} finally {
			gate.release();
			await observed;
		}
	},
);

await test(
	'Plugin asset concurrency: HTTP cancellation ends only that wait and later assets and management remain usable',
	{ timeout: 60000 },
	async (t) => {
		const { f, assets, url, gate } = await setup(t);
		const [first, second] = Object.keys(assets);
		const abort = new AbortController();
		const cancelled = f.api('GET', url(first), undefined, undefined, { signal: abort.signal });
		const observed = Promise.allSettled([cancelled]);
		try {
			await until(() => gate.entered, Boolean, 'cancelled request reached a real open blob handle');
			abort.abort();
			await assert.rejects(cancelled, (error) => error.name === 'AbortError');
			await until(() => gate.signal.aborted, Boolean, 'HTTP disconnect reaches the actual package reader');
			expectStatus(await f.api('GET', '/api/v1/agent/plugins/packages'), 200);
			const later = f.api('GET', url(second));
			gate.release();
			const response = await later;
			assert.equal(response.status, 200);
			assert.equal(response.bytes.toString(), assets[second]);
			assert.equal(gate.active, false);
			expectStatus(await f.api('GET', '/api/v1/agent/plugins/publishers'), 200);
		} finally {
			gate.release();
			await observed;
		}
	},
);

await test(
	'Plugin asset concurrency: queued assets recheck a revoked grant before any stale bytes are delivered',
	{ timeout: 60000 },
	async (t) => {
		const { f, plugin, assets, url, gate, owner } = await setup(t);
		const [first, second] = Object.keys(assets);
		const active = f.api('GET', url(first));
		const queued = f.api('GET', url(second));
		const observed = Promise.allSettled([active, queued]);
		try {
			await until(
				() => gate.entered && owner.pending.size >= 2,
				Boolean,
				'one actual read and a second queued HTTP asset',
			);
			await plugin.enabled(false);
			gate.release();
			const [activeResponse, queuedResponse] = await Promise.all([active, queued]);
			assert.equal(queuedResponse.status, 403);
			assert.notEqual(
				activeResponse.status,
				200,
				'the held read also rechecks live authorization before publishing bytes',
			);
			await plugin.enabled(true);
			const fresh = expectStatus(
				await f.api('GET', '/api/v1/agent/plugins/installations/' + plugin.appId + '/descriptor'),
				200,
			);
			assert.equal((await f.api('GET', fresh.url)).status, 200);
		} finally {
			gate.release();
			await observed;
		}
	},
);

await test(
	'Plugin asset concurrency: service close waits until the actual held package read closes',
	{ timeout: 60000 },
	async (t) => {
		const { f, assets, url, gate, owner } = await setup(t);
		const pending = f.api('GET', url(Object.keys(assets)[0]));
		const observed = Promise.allSettled([pending]);
		let closing;
		try {
			await until(() => gate.entered, Boolean, 'real package handle is open before shutdown');
			let closed = false;
			closing = owner.close().then(() => {
				closed = true;
			});
			await until(() => gate.signal.aborted, Boolean, 'owner shutdown aborts the package read');
			assert.equal(closed, false);
			assert.equal(gate.active, true);
			gate.release();
			await closing;
			assert.equal(
				gate.active,
				false,
				'shutdown owns the real reader until its generator and file handle converge',
			);
			await observed;
		} finally {
			gate.release();
			await closing;
			await observed;
		}
	},
);
