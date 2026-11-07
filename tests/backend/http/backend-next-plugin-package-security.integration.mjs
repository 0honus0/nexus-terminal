import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AGENT_PLUGIN_FRONTEND_SANDBOX } from '../../../packages/shared/dist/agent/plugins/values.js';
import { openPlugins } from './plugin-management-fixture.mjs';
import { expectStatus } from '../remote/openssh-fixture.mjs';

const base = '/api/v1/agent/plugins';

// These package and asset boundaries remain relevant independently of App execution policy.
await test('SDK4 signed package admission and sandbox assets preserve their original security boundaries', async (t) => {
	const f = await openPlugins(t);
	const initial = expectStatus(await f.api('GET', base + '/packages'), 200);
	const bytes = await f.build('package-security');

	async function stage(bytes) {
		const artifact = await f.upload(f.source.id, bytes);
		return expectStatus(
			await f.api('POST', base + '/stage', {
				artifactAppId: f.source.id,
				artifactId: artifact.id,
				expectedVersion: artifact.version,
			}),
			200,
		);
	}

	const verify = (stage) => f.api('POST', base + '/verify', { stageId: stage.id, expectedVersion: stage.version });

	await t.test('publisher key normalization is stable and repeated trust has one identity', async () => {
		const key = f.publisher;
		const again = expectStatus(
			await f.api('POST', base + '/publishers', {
				label: key.label,
				publicKeyPem: key.publicKeyPem,
			}),
			200,
		);
		assert.deepEqual(again, key);
	});
	await t.test('tampered signatures and malformed archives never install content', async () => {
		const signature = execFileSync('tar', ['-xOf', '-', './signature.ed25519'], { input: bytes });
		assert.equal(signature.length, 64);
		const tampered = Buffer.from(bytes);
		const offset = tampered.indexOf(signature);
		assert.ok(offset >= 0);
		tampered[offset] ^= 1;
		for (const [input, status] of [
			[tampered, 403],
			[Buffer.from('not an archive'), 400],
		]) {
			const staged = await stage(input);
			expectStatus(await verify(staged), status);
			assert.equal(expectStatus(await f.api('GET', base + '/stages/' + staged.id), 200).status, 'staged');
			assert.deepEqual(expectStatus(await f.api('GET', base + '/packages'), 200), initial);
		}
	});

	const plugin = await f.install('package-security', { enabled: false });
	await t.test('disabled install and repeated exact install preserve package and App identities', async () => {
		assert.equal(expectStatus(await f.api('GET', plugin.appPath), 200).enabled, false);
		assert.equal(expectStatus(await f.api('GET', base + '/installations/' + plugin.appId + '/runtime'), 200), null);
		const before = expectStatus(await f.api('GET', base + '/installations'), 200);
		const installed = await f.packageInstallation(plugin.installation.definitionId);
		expectStatus(
			await f.api('POST', base + '/packages/install', {
				stageId: plugin.stage.id,
				expectedVersion: plugin.stage.version,
			}),
			409,
		);
		const currentStage = expectStatus(await f.api('GET', base + '/stages/' + plugin.stage.id), 200);
		const replay = expectStatus(
			await f.api('POST', base + '/packages/install', {
				stageId: currentStage.id,
				expectedVersion: currentStage.version,
			}),
			200,
		);
		assert.deepEqual(replay.installation, installed);
		assert.deepEqual(expectStatus(await f.api('GET', base + '/installations'), 200), before);
	});
	await t.test('a signed version cannot be overwritten by different valid signed bytes', async () => {
		const original = await f.packageInstallation(plugin.installation.definitionId);
		const staged = await stage(
			await f.build('package-security', {
				frontendMarkup: '<!doctype html><p>different signed bytes</p>',
			}),
		);
		const verified = expectStatus(await verify(staged), 200);
		expectStatus(
			await f.api('POST', base + '/packages/install', {
				stageId: verified.id,
				expectedVersion: verified.version,
			}),
			409,
		);
		assert.deepEqual(await f.packageInstallation(plugin.installation.definitionId), original);
	});
	await plugin.enabled(true);
	const descriptorPath = base + '/installations/' + plugin.appId + '/descriptor';
	const descriptor = expectStatus(await f.api('GET', descriptorPath), 200);
	await t.test(
		'only signed frontend assets and SDK4 are public with restrictive sandbox and MIME headers',
		async () => {
			const asset = await f.anonymous('GET', descriptor.url);
			expectStatus(asset, 200);
			assert.equal(
				asset.bytes.toString(),
				'<!doctype html><title>plugin</title><script type="module" src="./client.mjs"></script>',
			);
			const directives = new Map(
				asset.headers['content-security-policy'].split(';').map((item) => {
					const [name, ...values] = item.trim().split(/\s+/u);
					return [name, values];
				}),
			);
			assert.deepEqual(new Set(directives.get('sandbox')), new Set(AGENT_PLUGIN_FRONTEND_SANDBOX.split(' ')));
			for (const name of ['form-action', 'connect-src', 'default-src', 'object-src', 'base-uri']) {
				assert.deepEqual(directives.get(name), ["'none'"]);
			}
			assert.deepEqual(directives.get('script-src'), ["'self'", "'wasm-unsafe-eval'"]);
			assert.deepEqual(directives.get('worker-src'), ['blob:']);
			assert.deepEqual(directives.get('style-src'), ["'self'", "'unsafe-inline'"]);
			assert.deepEqual(directives.get('img-src'), ["'self'", 'data:', 'blob:']);
			assert.deepEqual(directives.get('font-src'), ["'self'", 'data:', 'blob:']);
			assert.deepEqual(directives.get('frame-ancestors'), ["'self'"]);
			assert.equal(asset.headers['referrer-policy'], 'no-referrer');
			assert.equal(asset.headers['content-type'], 'text/html; charset=utf-8');
			for (const version of [1, 2, 3])
				expectStatus(await f.anonymous('GET', '/sdk/frontend-v' + version + '.mjs'), 404);
			const sdk = await f.anonymous('GET', '/sdk/frontend-v4.mjs');
			expectStatus(sdk, 200);
			const expected = await readFile(
				new URL(
					'../../../packages/backend/dist/modules/agent/plugins/adapters/frontend/frontend-v4.mjs',
					import.meta.url,
				),
			);
			assert.equal(
				createHash('sha256').update(sdk.bytes).digest('hex'),
				createHash('sha256').update(expected).digest('hex'),
			);
			assert.equal(sdk.headers['content-type'], 'text/javascript; charset=utf-8');
			assert.equal(sdk.headers['content-security-policy'], undefined);
			for (const response of [asset, sdk]) {
				assert.equal(response.headers['content-length'], String(response.bytes.length));
				assert.equal(response.headers['x-content-type-options'], 'nosniff');
				assert.equal(response.headers['cross-origin-resource-policy'], 'cross-origin');
				assert.equal(response.headers['access-control-allow-origin'], '*');
				assert.equal(response.headers['cache-control'], 'no-store');
			}
			expectStatus(
				await f.anonymous('GET', descriptor.url.replace('/frontend/index.html', '/backend/index.mjs')),
				400,
			);
			expectStatus(
				await f.anonymous(
					'GET',
					descriptor.url.replace('/' + descriptor.url.split('/')[4] + '/', '/' + randomUUID() + '/'),
				),
				403,
			);
		},
	);
	await t.test('disable revokes the exact asset grant permanently across reenable', async () => {
		await plugin.enabled(false);
		expectStatus(await f.anonymous('GET', descriptor.url), 403);
		await plugin.enabled(true);
		expectStatus(await f.anonymous('GET', descriptor.url), 403);
		expectStatus(await f.anonymous('GET', expectStatus(await f.api('GET', descriptorPath), 200).url), 200);
	});
	await t.test('revoked publisher cannot verify a new stage or regain content through restart', async () => {
		const staged = await stage(bytes);
		expectStatus(
			await f.api('DELETE', base + '/publishers/' + f.publisher.keyId, { expectedVersion: f.publisher.version }),
			200,
		);
		expectStatus(await verify(staged), 403);
		await f.restart();
		expectStatus(await f.anonymous('GET', descriptor.url), 403);
		assert.notEqual(
			expectStatus(await f.api('GET', base + '/publishers'), 200).items.find(
				(item) => item.keyId === f.publisher.keyId,
			).revokedAt,
			null,
		);
	});
});
