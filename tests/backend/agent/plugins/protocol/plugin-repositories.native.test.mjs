import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { openPlugins } from '../support/plugin-management-fixture.mjs';
import { expectStatus, until } from '../../../../support/protocols/openssh-fixture.mjs';
import { OFFICIAL_PLUGIN_SOURCE } from '../../../../../packages/backend/dist/modules/agent/plugins/service/plugin-source.js';
import { PluginService } from '../../../../../packages/backend/dist/modules/agent/plugins/service/plugin-service.js';
import {
	readAgentPluginCatalog,
	readAgentPluginRecommended,
	readAgentPluginRepositorySettings,
} from '../../../../../packages/shared/dist/agent/plugins/repository-http-codec.js';

const base = '/api/v1/agent/plugins';
const recommendedPath = '/api/v1/agent/onboarding/recommended-plugin';
const product = createRequire(new URL('../../../../../package.json', import.meta.url))('./package.json');

await test('B10 onboarding initialization commits enabled App and full declared grants without restoring revoked grants', async (t) => {
	const f = await openPlugins((close) => t.after(close));
	const install = PluginService.prototype.composeApp;
	let initialize = true;
	// Exercise the internal onboarding decision with a real signed package and SQLite transaction.
	// This is not an official-publisher installation and does not replace or relax its pinned key.
	t.mock.method(PluginService.prototype, 'composeApp', function (actor, packageId, options) {
		return install.call(this, actor, packageId, initialize ? { enableWithDeclaredGrants: true } : options);
	});
	const capabilities = ['file.read', 'shell.execute', 'machine.inspect', 'context.read'];
	const plugin = await f.install('onboarding-initialization', {
		capabilities,
		enabled: false,
	});
	assert.equal(expectStatus(await f.api('GET', plugin.appPath), 200).enabled, true);
	const grants = expectStatus(await f.api('GET', plugin.appPath + '/grants'), 200).grants;
	assert.deepEqual(grants.map((grant) => grant.capability).sort(), capabilities.toSorted());
	for (const grant of grants) {
		assert.deepEqual(
			grant.scope,
			['file.read', 'shell.execute'].includes(grant.capability)
				? { kind: 'targets', targets: { ssh: { mode: 'all' } } }
				: { kind: 'global' },
		);
	}
	await until(
		async () => expectStatus(await f.api('GET', base + '/installations/' + plugin.appId + '/runtime'), 200).state,
		(state) => state === 'active',
		'onboarding starts the current SDK4 App',
	);
	await plugin.grants([]);
	await plugin.enabled(false);
	const stage = expectStatus(await f.api('GET', base + '/stages'), 200).items.find(
		(item) => item.manifest?.id === plugin.installation.definitionId,
	);
	assert.ok(stage);
	expectStatus(
		await f.api('POST', base + '/packages/install', { stageId: stage.id, expectedVersion: stage.version }),
		200,
	);
	assert.equal(expectStatus(await f.api('GET', plugin.appPath), 200).enabled, false);
	assert.deepEqual(expectStatus(await f.api('GET', plugin.appPath + '/grants'), 200).grants, []);
	initialize = false;
	const ordinary = await f.install('ordinary-initialization', { capabilities, enabled: false });
	assert.equal(expectStatus(await f.api('GET', ordinary.appPath), 200).enabled, false);
	assert.deepEqual(expectStatus(await f.api('GET', ordinary.appPath + '/grants'), 200).grants, []);
});

await test('B10 actual repository HTTP, signed downloads and configuration ordering', { timeout: 60000 }, async (t) => {
	let catalog;
	let bytes;
	let mode = 'normal';
	let held;
	const requests = [];
	const server = createServer((request, response) => {
		requests.push({ path: request.url, headers: request.headers });
		if (request.url.startsWith('/catalog')) {
			if (mode === 'hold') {
				held = () => response.end(JSON.stringify(catalog));
				return;
			}
			if (mode === 'bad-utf8') {
				response.end(Buffer.from([0xff]));
				return;
			}
			if (mode === 'over-budget') {
				response.end(' '.repeat(1024 * 1024 + 1));
				return;
			}
			response.end(JSON.stringify(catalog));
			return;
		}
		if (request.url === '/redirect') {
			response.writeHead(302, { Location: '/package.tar' });
			response.end();
			return;
		}
		if (request.url === '/redirect-loop') {
			response.writeHead(302, { Location: '/redirect-loop' });
			response.end();
			return;
		}
		if (request.url === '/package.tar') {
			response.end(bytes);
			return;
		}
		response.writeHead(404);
		response.end('not found');
	});
	t.after(async () => {
		held?.();
		server.closeAllConnections();
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const f = await openPlugins((close) => t.after(close));
	const initialStages = expectStatus(await f.api('GET', base + '/stages'), 200).items;
	const url = 'http://127.0.0.1:' + server.address().port + '/catalog.json';
	const packageBytes = await f.build('repository');
	bytes = packageBytes;
	const entry = {
		packageId: 'isolated.b10-repository',
		version: '1.0.0',
		compatibility: {
			host: { minVersion: product.version, maxVersion: product.version },
			backendSdk: 4,
			frontendSdk: 4,
		},
		contributionKinds: ['app', 'ui'],
		displayName: 'repository',
		description: 'isolated download',
		packageUrl: './package.tar',
		sha256: createHash('sha256').update(bytes).digest('hex'),
		sizeBytes: bytes.length,
		publisherKeyId: f.publisher.keyId,
	};
	const original = {
		schemaVersion: 2,
		publishers: [{ keyId: f.publisher.keyId, label: f.publisher.label, publicKeyPem: f.publisher.publicKeyPem }],
		packages: [entry],
	};
	catalog = structuredClone(original);
	let settings;
	let stage;

	const read = () => f.api('GET', base + '/remote/catalog?repositoryUrl=' + encodeURIComponent(url));

	const save = (repositories, expectedVersion = settings.version) =>
		f.api('PUT', base + '/repositories', { expectedVersion, repositories });

	const download = (version = entry.version) =>
		f.api('POST', base + '/remote/stage', {
			repositoryUrl: url,
			packageId: entry.packageId,
			publisherKeyId: catalog.packages[0].publisherKeyId,
			version,
		});

	await t.test('anonymous endpoints refuse before external access', async () => {
		expectStatus(await f.anonymous('GET', base + '/repositories'), 401);
		expectStatus(await f.anonymous('GET', base + '/remote/catalog?repositoryUrl=' + encodeURIComponent(url)), 401);
		expectStatus(await f.anonymous('POST', base + '/remote/stage', {}), 401);
		assert.equal(requests.length, 0);
	});
	await t.test('unconfigured source is forbidden and the fixture restores its repository list', async () => {
		settings = readAgentPluginRepositorySettings(expectStatus(await f.api('GET', base + '/repositories'), 200));
		assert.deepEqual(settings.repositories, []);
		assert.equal(settings.version, 2, 'fixture source install configured and restored its local repository');
		expectStatus(await read(), 403);
		assert.equal(requests.length, 0);
	});
	for (const [label, repositories] of [
		['credentials', [{ url: 'https://user:secret@example.test/catalog' }]],
		['fragment', [{ url: url + '#private' }]],
		['duplicate canonical URL', [{ url: 'https://EXAMPLE.test:443/' }, { url: 'https://example.test/' }]],
		['unknown nested field', [{ url, token: 'not allowed' }]],
	]) {
		await t.test(label + ' rejects without changing repository version', async () => {
			expectStatus(await save(repositories), 400);
			assert.deepEqual(expectStatus(await f.api('GET', base + '/repositories'), 200), settings);
		});
	}
	await t.test('save succeeds without fetching source; stale CAS cannot overwrite', async () => {
		settings = readAgentPluginRepositorySettings(expectStatus(await save([{ url }]), 200));
		assert.equal(settings.version, 3);
		assert.equal(requests.length, 0);
		expectStatus(await save([], 0), 409);
		assert.deepEqual(expectStatus(await f.api('GET', base + '/repositories'), 200), settings);
	});
	await t.test('real UTF-8 catalog maps relative package URL and exact product compatibility', async () => {
		const result = readAgentPluginCatalog(expectStatus(await read(), 200));
		assert.equal(result.repositoryUrl, url);
		assert.equal(result.packages[0].compatible, true);
		assert.equal(result.packages[0].packageUrl, new URL('./package.tar', url).href);
		assert.equal(requests.at(-1).headers.authorization, undefined);
		assert.equal(requests.at(-1).headers.cookie, undefined);
	});
	await t.test('more than sixteen configured sources fit and restoring one advances CAS', async () => {
		const sources = Array.from({ length: 24 }, (_, index) => ({ url: url + '?source=' + index }));
		settings = expectStatus(await save(sources), 200);
		assert.deepEqual(settings.repositories, sources);
		settings = expectStatus(await save([{ url }]), 200);
		assert.deepEqual(settings.repositories, [{ url }]);
	});
	await t.test('missing, duplicate and unknown catalog queries reject without network dispatch', async () => {
		const before = requests.length;
		for (const query of [
			'',
			'?repositoryUrl=' + encodeURIComponent(url) + '&repositoryUrl=' + encodeURIComponent(url),
			'?repositoryUrl=' + encodeURIComponent(url) + '&extra=1',
		]) {
			expectStatus(await f.api('GET', base + '/remote/catalog' + query), 400);
		}
		assert.equal(requests.length, before);
	});
	await t.test('catalog lookup alone does not grant publisher trust', async () => {
		catalog.publishers.push({
			keyId: 'ed25519:' + 'a'.repeat(64),
			label: 'untrusted',
			publicKeyPem: f.publisher.publicKeyPem,
		});
		expectStatus(await read(), 200);
		assert.equal(expectStatus(await f.api('GET', base + '/publishers'), 200).items.length, 1);
		catalog = structuredClone(original);
	});
	for (const [label, change] of [
		['duplicate publisher', (value) => value.publishers.push(value.publishers[0])],
		['duplicate package', (value) => value.packages.push(value.packages[0])],
		[
			'missing publisher',
			(value) => {
				value.publishers = [];
			},
		],
		[
			'unknown root field',
			(value) => {
				value.password = 'forbidden';
			},
		],
		[
			'invalid version',
			(value) => {
				value.packages[0].version = 'latest';
			},
		],
		[
			'invalid public-key control',
			(value) => {
				value.publishers[0].publicKeyPem += '\u0000';
			},
		],
	]) {
		await t.test(label + ' produces safe upstream failure without poisoning owner', async () => {
			catalog = structuredClone(original);
			change(catalog);
			assert.equal(expectStatus(await read(), 503).code, 'provider_unavailable');
			catalog = structuredClone(original);
			expectStatus(await read(), 200);
		});
	}
	for (const failure of ['bad-utf8', 'over-budget']) {
		await t.test(failure + ' is refused at the real network/decoder boundary', async () => {
			mode = failure;
			const result = await read();
			expectStatus(result, failure === 'bad-utf8' ? 503 : 413);
			assert.equal(result.body.code, failure === 'bad-utf8' ? 'provider_unavailable' : 'limit_exceeded');
			mode = 'normal';
		});
	}
	await t.test('incompatible SDK and product versions are visible but cannot stage', async () => {
		for (const changed of [
			{ compatibility: { ...entry.compatibility, frontendSdk: 3 } },
			{ compatibility: { ...entry.compatibility, host: { minVersion: '999.0.0', maxVersion: '999.0.0' } } },
		]) {
			catalog = structuredClone(original);
			Object.assign(catalog.packages[0], changed);
			assert.equal(readAgentPluginCatalog(expectStatus(await read(), 200)).packages[0].compatible, false);
			expectStatus(await download(), 403);
		}
		catalog = structuredClone(original);
		expectStatus(await download('9.0.0'), 404);
	});
	await t.test('changed bytes, declared length and redirect loop cannot create a stage', async () => {
		bytes = Buffer.from(packageBytes);
		bytes[0] ^= 1;
		expectStatus(await download(), 503);
		bytes = packageBytes.subarray(0, packageBytes.length - 1);
		expectStatus(await download(), 503);
		bytes = packageBytes;
		catalog.packages[0].packageUrl = '/redirect-loop';
		expectStatus(await download(), 503);
		catalog = structuredClone(original);
		assert.deepEqual(expectStatus(await f.api('GET', base + '/stages'), 200).items, initialStages);
	});
	await t.test('catalog identity cannot relabel actual signed package version or publisher', async () => {
		catalog.packages[0].version = '1.0.1';
		expectStatus(await download('1.0.1'), 403);
		catalog = structuredClone(original);
		const keyId = 'ed25519:' + 'b'.repeat(64);
		catalog.publishers.push({ keyId, label: 'relabeled', publicKeyPem: f.publisher.publicKeyPem });
		catalog.packages[0].publisherKeyId = keyId;
		expectStatus(await download(), 403);
		catalog = structuredClone(original);
		assert.deepEqual(expectStatus(await f.api('GET', base + '/stages'), 200).items, initialStages);
	});
	await t.test('redirected real package stages, verifies and installs disabled with empty grants', async () => {
		catalog.packages[0].packageUrl = '/redirect';
		stage = expectStatus(await download(), 200);
		assert.equal(stage.status, 'verified');
		const { installation: installedPackage } = expectStatus(
			await f.api('POST', base + '/packages/install', { stageId: stage.id, expectedVersion: stage.version }),
			200,
		);
		assert.equal(installedPackage.packageId, entry.packageId);
		const { binding } = expectStatus(
			await f.api('POST', base + '/apps/compose', {
				packageId: entry.packageId,
				selectedRootIds: [],
				uiPackageId: entry.packageId,
			}),
			200,
		);
		const installed = expectStatus(await f.api('GET', base + '/installations'), 200).items.find(
			(item) => item.appId === binding.appId,
		);
		assert.equal(installed.definitionId, entry.packageId);
		assert.equal(expectStatus(await f.api('GET', '/api/v1/agent/apps/' + installed.appId), 200).enabled, false);
		assert.deepEqual(
			expectStatus(await f.api('GET', '/api/v1/agent/apps/' + installed.appId + '/grants'), 200).grants,
			[],
		);
		catalog = structuredClone(original);
	});
	await t.test('revoked publisher cannot be trusted again by catalog or a valid downloaded signature', async () => {
		expectStatus(
			await f.api('DELETE', base + '/publishers/' + encodeURIComponent(f.publisher.keyId), {
				expectedVersion: f.publisher.version,
			}),
			200,
		);
		expectStatus(await read(), 200);
		expectStatus(await download(), 403);
		const publishers = expectStatus(await f.api('GET', base + '/publishers'), 200).items;
		assert.notEqual(publishers[0].revokedAt, null);
		const installed = expectStatus(await f.api('GET', base + '/installations'), 200).items;
		assert.equal(installed.length, 2);
		for (const installation of installed) {
			assert.equal(
				expectStatus(await f.api('GET', '/api/v1/agent/apps/' + installation.appId), 200).enabled,
				false,
			);
		}
	});
	await t.test('in-flight read finishes before queued configuration update; later reads see removal', async () => {
		mode = 'hold';
		held = undefined;
		const reading = read();
		await until(async () => Boolean(held), Boolean, 'catalog request reached real server');
		let saved = false;
		const writing = save([]).then((result) => {
			saved = true;
			return result;
		});
		assert.equal(saved, false);
		held();
		held = undefined;
		expectStatus(await reading, 200);
		settings = expectStatus(await writing, 200);
		expectStatus(await read(), 403);
		mode = 'normal';
	});
	await t.test('session revoked during actual catalog fetch cannot receive the late result', async () => {
		settings = expectStatus(await save([{ url }]), 200);
		mode = 'hold';
		held = undefined;
		const reading = read();
		await until(async () => Boolean(held), Boolean, 'catalog before logout');
		expectStatus(await f.api('POST', '/api/v1/auth/logout', {}), 200);
		held();
		held = undefined;
		expectStatus(await reading, 401);
		mode = 'normal';
		await f.login();
		expectStatus(await read(), 200);
	});
	await t.test('controlled restart retains only latest repository settings', async () => {
		await f.restart();
		assert.deepEqual(expectStatus(await f.api('GET', base + '/repositories'), 200), settings);
	});
});

await test(
	'B10 official pinned catalog and offline recommendation through real HTTP',
	{ timeout: 60000 },
	async (t) => {
		const f = await openPlugins((close) => t.after(close));
		const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = createRequire(
			new URL('../../../../../packages/backend/package.json', import.meta.url),
		)('undici');
		const previous = getGlobalDispatcher();
		const mock = new MockAgent();
		mock.disableNetConnect();
		setGlobalDispatcher(mock);
		t.after(async () => {
			setGlobalDispatcher(previous);
			await mock.close();
		});
		const source = new URL(OFFICIAL_PLUGIN_SOURCE.catalogUrl);
		let catalog = {
			schemaVersion: 2,
			publishers: [
				{
					keyId: OFFICIAL_PLUGIN_SOURCE.publisherKeyId,
					label: 'official',
					publicKeyPem: OFFICIAL_PLUGIN_SOURCE.publisherPublicKeyPem,
				},
			],
			packages: [],
		};
		mock.get(source.origin)
			.intercept({ path: source.pathname })
			.reply(() => ({ statusCode: 200, data: JSON.stringify(catalog) }))
			.persist();

		const entry = (version, changes = {}) => ({
			packageId: OFFICIAL_PLUGIN_SOURCE.recommendedAppId,
			version,
			compatibility: { host: { minVersion: '0.0.0', maxVersion: '999.0.0' }, backendSdk: null, frontendSdk: 4 },
			contributionKinds: ['app', 'ui'],
			displayName: 'official metadata',
			description: 'catalog only',
			packageUrl: 'https://example.invalid/package.tar',
			sha256: 'a'.repeat(64),
			sizeBytes: 1,
			publisherKeyId: OFFICIAL_PLUGIN_SOURCE.publisherKeyId,
			...changes,
		});

		await t.test('LF and CRLF public key use the same actual pinned identity', async () => {
			for (const pem of [
				OFFICIAL_PLUGIN_SOURCE.publisherPublicKeyPem,
				OFFICIAL_PLUGIN_SOURCE.publisherPublicKeyPem.replaceAll('\n', '\r\n'),
			]) {
				catalog.publishers[0].publicKeyPem = pem;
				expectStatus(await f.api('GET', base + '/official/catalog'), 200);
			}
		});
		await t.test('different valid public key cannot masquerade as pinned publisher', async () => {
			catalog.publishers[0].publicKeyPem = f.publisher.publicKeyPem;
			expectStatus(await f.api('GET', base + '/official/catalog'), 403);
			catalog.publishers[0].publicKeyPem = OFFICIAL_PLUGIN_SOURCE.publisherPublicKeyPem;
		});
		await t.test('recommendation chooses latest compatible semantic version, not lexical order', async () => {
			catalog.packages = [
				entry('1.9.0'),
				entry('1.10.0-beta.2'),
				entry('1.10.0-beta.11'),
				entry('1.10.0'),
				entry('2.0.0', { compatibility: { ...entry('2.0.0').compatibility, frontendSdk: 2 } }),
			];
			const result = readAgentPluginRecommended(expectStatus(await f.api('GET', recommendedPath), 200));
			assert.equal(result.entry.version, '1.10.0');
			assert.equal(result.installation, null);
		});
		await t.test(
			'no compatible recommendation gives explicit not-found and malformed install is rejected',
			async () => {
				catalog.packages = [];
				assert.deepEqual(expectStatus(await f.api('GET', recommendedPath), 200), {
					entry: null,
					installation: null,
				});
				expectStatus(
					await f.api('POST', base + '/official/prepare', {
						packageId: OFFICIAL_PLUGIN_SOURCE.recommendedAppId,
						publisherKeyId: OFFICIAL_PLUGIN_SOURCE.publisherKeyId,
						version: '9.9.9',
					}),
					404,
				);
				expectStatus(await f.api('POST', recommendedPath + '/install', {}), 400);
				expectStatus(
					await f.api('POST', recommendedPath + '/install', { operationId: randomUUID(), grantAll: true }),
					400,
				);
			},
		);
		await t.test('uninstalled recommendation reports provider unavailable when catalog is offline', async () => {
			const unavailable = new MockAgent();
			unavailable.disableNetConnect();
			setGlobalDispatcher(unavailable);
			try {
				assert.deepEqual(expectStatus(await f.api('GET', recommendedPath), 503), {
					code: 'provider_unavailable',
				});
			} finally {
				setGlobalDispatcher(mock);
				await unavailable.close();
			}
		});
		await t.test(
			'installed recommendation is returned offline without fetching or enabling it (read-only installation fact fixture)',
			async (t) => {
				const plugin = await f.install('offline-recommended', { enabled: false });
				// Only the read boundary supplies the already-verified official identity here.
				// The real custom-signed install above is not an official signed-package installation.
				const installation = {
					appId: plugin.installation.appId,
					definitionId: OFFICIAL_PLUGIN_SOURCE.recommendedAppId,
					version: plugin.installation.version,
					packageHash: plugin.installation.packageHash,
					publisherKeyId: OFFICIAL_PLUGIN_SOURCE.publisherKeyId,
					status: plugin.installation.status,
					revision: plugin.installation.revision,
					createdAt: plugin.installation.createdAt,
					updatedAt: plugin.installation.updatedAt,
				};
				const listInstallations = PluginService.prototype.installations;
				t.mock.method(PluginService.prototype, 'installations', async function (actor) {
					return (await listInstallations.call(this, actor)).map((item) =>
						item.appId === installation.appId ? installation : item,
					);
				});
				const unavailable = new MockAgent();
				unavailable.disableNetConnect();
				setGlobalDispatcher(unavailable);
				try {
					const result = readAgentPluginRecommended(expectStatus(await f.api('GET', recommendedPath), 200));
					assert.equal(result.entry, null);
					assert.deepEqual(result.installation, installation);
					assert.deepEqual(
						expectStatus(
							await f.api('POST', recommendedPath + '/install', {
								kind: 'existing',
								appId: plugin.appId,
								expectedRevision: plugin.installation.revision,
							}),
							200,
						),
						{ kind: 'existing', installation },
					);
					expectStatus(
						await f.api('POST', recommendedPath + '/install', {
							kind: 'existing',
							appId: plugin.appId,
							expectedRevision: installation.revision + 1,
						}),
						409,
					);
					assert.equal(expectStatus(await f.api('GET', plugin.appPath), 200).enabled, false);
					assert.deepEqual(expectStatus(await f.api('GET', plugin.appPath + '/grants'), 200).grants, []);
				} finally {
					setGlobalDispatcher(mock);
					await unavailable.close();
				}
			},
		);
	},
);
