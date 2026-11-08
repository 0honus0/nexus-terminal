import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { openPlugins } from '../support/plugin-management-fixture.mjs';
import { expectStatus, until } from '../../../../support/protocols/openssh-fixture.mjs';

await test(
	'Agent modular: a slow catalog cannot block another source or local package management',
	{ timeout: 60000 },
	async (t) => {
		const catalog = Buffer.from(JSON.stringify({ schemaVersion: 2, publishers: [], packages: [] }));
		let held;
		let slowReads = 0;
		const server = createServer((request, response) => {
			if (request.url === '/slow/catalog.json') {
				slowReads++;
				held = response;
				response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': catalog.length });
				response.write(catalog.subarray(0, 1));
				return;
			}
			if (request.url === '/fast/catalog.json') {
				response.writeHead(200, { 'Content-Type': 'application/json' });
				response.end(catalog);
				return;
			}
			response.writeHead(404).end();
		});
		t.after(async () => {
			held?.end(catalog.subarray(1));
			server.closeAllConnections();
			await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		});
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		const f = await openPlugins((close) => t.after(close));
		const origin = 'http://127.0.0.1:' + server.address().port;
		const slowUrl = origin + '/slow/catalog.json',
			fastUrl = origin + '/fast/catalog.json';
		const settings = expectStatus(await f.api('GET', '/api/v1/agent/plugins/repositories'), 200);
		const configured = expectStatus(
			await f.api('PUT', '/api/v1/agent/plugins/repositories', {
				expectedVersion: settings.version,
				repositories: [{ url: slowUrl }, { url: fastUrl }],
			}),
			200,
		);
		const slow = f.api('GET', '/api/v1/agent/plugins/remote/catalog?repositoryUrl=' + encodeURIComponent(slowUrl));
		const observed = Promise.allSettled([slow]);
		await until(
			() => slowReads,
			(count) => count === 1,
			'actual slow source starts its partial response',
		);
		const fast = expectStatus(
			await f.api('GET', '/api/v1/agent/plugins/remote/catalog?repositoryUrl=' + encodeURIComponent(fastUrl)),
			200,
		);
		assert.equal(fast.repositoryUrl, fastUrl);
		assert.deepEqual(fast.packages, []);
		assert.ok(expectStatus(await f.api('GET', '/api/v1/agent/plugins/packages'), 200).installations.length > 0);
		expectStatus(
			await f.api('PUT', '/api/v1/agent/plugins/repositories', {
				expectedVersion: configured.version,
				repositories: [{ url: fastUrl }],
			}),
			200,
		);
		held.end(catalog.subarray(1));
		const [late] = await observed;
		assert.equal(late.status, 'fulfilled');
		assert.equal(
			expectStatus(late.value, 409).code,
			'version_conflict',
			'removed source cannot publish a late successful catalog',
		);
	},
);

await test(
	'Agent modular: two Apps share one installed package and isolate data, grants and disable',
	{ timeout: 60000 },
	async (t) => {
		const f = await openPlugins((close) => t.after(close));
		const first = await f.install('shared-package', { capabilities: ['artifacts.read'] });
		const { binding } = expectStatus(
			await f.api('POST', '/api/v1/agent/plugins/apps/compose', {
				packageId: first.installation.definitionId,
				selectedRootIds: [],
				uiPackageId: first.installation.definitionId,
			}),
			200,
		);
		assert.notEqual(binding.appId, first.appId);
		assert.equal(binding.app.packageHash, first.installation.packageHash);
		const secondPath = '/api/v1/agent/apps/' + binding.appId;
		const second = expectStatus(await f.api('GET', secondPath), 200);
		assert.equal(second.enabled, false, 'composition does not implicitly enable an App');
		assert.deepEqual(expectStatus(await f.api('GET', secondPath + '/grants'), 200).grants, []);
		await first.grants(['artifacts.read']);
		assert.deepEqual(expectStatus(await f.api('GET', secondPath + '/grants'), 200).grants, []);
		const enabledSecond = expectStatus(
			await f.api('PATCH', secondPath, { expectedVersion: second.version, enabled: true }),
			200,
		);
		const firstData = '/api/v1/agent/plugins/installations/' + first.appId + '/data/shared';
		const secondInstallationPath = '/api/v1/agent/plugins/installations/' + binding.appId;
		const secondInstallation = expectStatus(
			await f.api('GET', '/api/v1/agent/plugins/installations'),
			200,
		).items.find((item) => item.appId === binding.appId);
		const secondData = secondInstallationPath + '/data/shared';

		const write = (path, revision, valueJson) =>
			f.api('PUT', path, {
				expectedRevision: revision,
				expectedVersion: 0,
				operationId: randomUUID(),
				valueJson,
			});

		expectStatus(await write(firstData, first.installation.revision, '{"owner":"first"}'), 200);
		assert.equal(expectStatus(await f.api('GET', secondData), 200).value, null);
		expectStatus(await write(secondData, secondInstallation.revision, '{"owner":"second"}'), 200);
		assert.equal(expectStatus(await f.api('GET', firstData), 200).value.valueJson, '{"owner":"first"}');
		assert.equal(expectStatus(await f.api('GET', secondData), 200).value.valueJson, '{"owner":"second"}');
		await first.enabled(false);
		assert.equal(expectStatus(await f.api('GET', secondPath), 200).version, enabledSecond.version);
		expectStatus(await f.api('GET', firstData), 403);
		assert.equal(expectStatus(await f.api('GET', secondData), 200).value.valueJson, '{"owner":"second"}');
		await first.enabled(true);
		assert.equal(expectStatus(await f.api('GET', firstData), 200).value.valueJson, '{"owner":"first"}');
		const packages = expectStatus(await f.api('GET', '/api/v1/agent/plugins/packages'), 200).installations;
		assert.equal(packages.filter((item) => item.packageId === binding.app.packageId).length, 1);
	},
);
