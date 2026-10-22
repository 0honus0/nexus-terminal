import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openManagement } from './management-fixture.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';
import {
	readAgentPluginInstallation,
	readAgentPluginStageView,
	readAgentPluginDescriptor,
	readAgentPluginDataView,
} from '../../../packages/shared/dist/agent/plugins/http-codec.js';

const definitionId = 'isolated.b10-plugin';
const backend = `import { marker } from './marker.mjs';
export async function activate({ context, request }) {
 const info = await request({ method: 'host.appInfo', params: {} });
 if (!info.ok || info.result.value.appId !== context.appId) throw new Error('context mismatch');
 const previous = await request({ method: 'storage.get', params: { key: 'runtime' } });
 if (!previous.ok) throw new Error('read failed');
 const value = previous.result.value;
 const count = value?.valueJson ? JSON.parse(value.valueJson).count + 1 : 1;
 const result = await request({ method: 'storage.put', params: { key: 'runtime', expectedVersion: value?.version ?? 0, operationId: crypto.randomUUID(), valueJson: JSON.stringify({ count, marker, version: context.version }) } });
 if (!result.ok) throw new Error('write failed');
}
export function health() { return true; }
`;

await test(
	'B10 signed plugin package, actual child runtime, storage CAS and retirement',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-plugin-'));
		const { privateKey, publicKey } = generateKeyPairSync('ed25519');
		const keyPath = join(directory, 'key.pem');
		await writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
		let f;
		let artifactApp;
		let staged;
		let installation;
		let descriptor;
		let publisher;
		let upgraded;
		let initialData;
		let rpcRequest;
		const base = '/api/v1/agent/plugins';

		const installPath = () => base + '/installations/' + installation.appId;

		const appPath = () => '/api/v1/agent/apps/' + installation.appId;

		const dataPath = (key) => installPath() + '/data/' + key;

		const data = async (key) => expectStatus(await f.api('GET', dataPath(key)), 200).value;

		const setEnabled = async (enabled) => {
			const app = expectStatus(await f.api('GET', appPath()), 200);
			return expectStatus(await f.api('PATCH', appPath(), { expectedVersion: app.version, enabled }), 200);
		};

		const runtime = async () => expectStatus(await f.api('GET', installPath() + '/runtime'), 200);

		async function childIdentity() {
			const root = f.database + '.modules';
			const directories = await readdir(root);
			assert.equal(directories.length, 1);
			const journal = JSON.parse(await readFile(join(root, directories[0], '.nexus-process.json'), 'utf8'));
			assert.equal(journal.parent.pid, process.pid);
			assert.notEqual(journal.child.pid, process.pid);
			const command = await readFile('/proc/' + journal.child.pid + '/cmdline', 'utf8');
			assert.ok(command.split('\0').includes(join(root, directories[0], '.nexus-runtime.mjs')));
			return journal.child;
		}

		async function assertExited(identity) {
			let stat;
			try {
				stat = await readFile('/proc/' + identity.pid + '/stat', 'utf8');
			} catch (error) {
				if (error.code === 'ENOENT') {
					return;
				}
				throw error;
			}
			// A reused PID is a different process; never signal it.
			assert.notEqual(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19], identity.started);
		}

		const ready = (count, version) =>
			until(
				async () => ({ runtime: await runtime(), data: await data('runtime') }),
				(value) =>
					value.runtime?.state === 'active' &&
					value.data !== null &&
					JSON.parse(value.data.valueJson).count === count &&
					JSON.parse(value.data.valueJson).version === version,
				'real plugin activation',
			);

		const verify = (value) =>
			f.api('POST', base + '/verify', { stageId: value.id, expectedVersion: value.version });

		async function build(version, marker = 'signed sibling', corruptSignature = false) {
			const source = join(directory, randomUUID());
			await mkdir(join(source, 'backend'), { recursive: true });
			await mkdir(join(source, 'frontend'));
			await writeFile(
				join(source, 'manifest.json'),
				JSON.stringify({
					schemaVersion: 1,
					id: definitionId,
					version,
					displayName: 'isolated plugin',
					sdkVersion: '1',
					capabilities: [],
					intents: [],
					frontendEntry: 'frontend/index.html',
					backendEntry: 'backend/main.mjs',
				}),
			);
			await writeFile(join(source, 'backend/main.mjs'), backend);
			await writeFile(
				join(source, 'backend/marker.mjs'),
				'export const marker = ' + JSON.stringify(marker) + ';',
			);
			await writeFile(
				join(source, 'frontend/index.html'),
				'<!doctype html><title>isolated plugin</title><p>signed asset</p>',
			);
			const archive = join(directory, randomUUID() + '.tar');
			execFileSync(
				process.execPath,
				[
					fileURLToPath(new URL('../../e2e/fixtures/agent/build-plugin-package.mjs', import.meta.url)),
					source,
					archive,
					keyPath,
				],
				{ stdio: 'pipe' },
			);
			const bytes = await readFile(archive);
			if (corruptSignature) {
				const signature = execFileSync('tar', ['-xOf', archive, './signature.ed25519']);
				assert.equal(signature.length, 64);
				const offset = bytes.indexOf(signature);
				assert.ok(offset >= 0);
				bytes[offset] ^= 1;
			}
			return bytes;
		}

		async function stage(bytes) {
			const path = '/api/v1/agent/apps/' + artifactApp.id + '/artifacts';
			let artifact = expectStatus(
				await f.api('POST', path, {
					name: 'plugin.tar',
					mediaType: 'application/x-tar',
					declaredBytes: bytes.length,
				}),
				201,
			).artifact;
			artifact = expectStatus(
				await f.api('PUT', path + '/' + artifact.id + '/content', bytes, {
					'Content-Type': 'application/octet-stream',
					'If-Match': '"' + artifact.version + '"',
				}),
				200,
			).artifact;
			return readAgentPluginStageView(
				expectStatus(
					await f.api('POST', base + '/stage', {
						artifactAppId: artifactApp.id,
						artifactId: artifact.id,
						expectedVersion: artifact.version,
					}),
					200,
				),
			);
		}

		try {
			f = await openManagement(directory);
			artifactApp = expectStatus(
				await f.api('POST', '/api/v1/agent/apps', { name: 'plugin package source' }),
				201,
			);
			await t.test('anonymous publisher and install administration are denied', async () => {
				expectStatus(await f.anonymous('GET', base + '/publishers'), 401);
				expectStatus(await f.anonymous('GET', base + '/installations'), 401);
			});
			await t.test(
				'real Artifact-to-stage copies immutable package; unverified install is rejected',
				async () => {
					staged = await stage(await build('1.0.0'));
					assert.equal(staged.status, 'staged');
					expectStatus(
						await f.api('POST', base + '/install', { stageId: staged.id, expectedVersion: staged.version }),
						409,
					);
				},
			);
			await t.test('valid signature without trusted publisher cannot verify', async () => {
				expectStatus(await verify(staged), 403);
				assert.equal(expectStatus(await f.api('GET', base + '/stages/' + staged.id), 200).status, 'staged');
			});
			await t.test('publisher key identity is normalized and idempotent', async () => {
				const input = {
					label: 'isolated signer',
					publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
				};
				publisher = expectStatus(await f.api('POST', base + '/publishers', input), 200);
				assert.equal(
					publisher.keyId,
					'ed25519:' +
						createHash('sha256')
							.update(publicKey.export({ type: 'spki', format: 'der' }))
							.digest('hex'),
				);
				assert.deepEqual(expectStatus(await f.api('POST', base + '/publishers', input), 200), publisher);
			});
			await t.test('tampered signature cannot verify even with a trusted publisher', async () => {
				const tampered = await stage(await build('1.0.0', 'signed sibling', true));
				expectStatus(await verify(tampered), 403);
				assert.equal(expectStatus(await f.api('GET', base + '/stages/' + tampered.id), 200).status, 'staged');
			});
			await t.test('malformed package refuses verification without installing or poisoning owner', async () => {
				const malformed = await stage(Buffer.from('not an archive'));
				expectStatus(await verify(malformed), 400);
				assert.deepEqual(expectStatus(await f.api('GET', base + '/installations'), 200).items, []);
			});
			await t.test(
				'verification validates signed manifest and package files; install creates disabled App',
				async () => {
					staged = readAgentPluginStageView(expectStatus(await verify(staged), 200));
					assert.equal(staged.status, 'verified');
					installation = readAgentPluginInstallation(
						expectStatus(
							await f.api('POST', base + '/install', {
								stageId: staged.id,
								expectedVersion: staged.version,
							}),
							200,
						),
					);
					assert.equal(installation.definitionId, definitionId);
					assert.equal(installation.status, 'installed');
					assert.equal(expectStatus(await f.api('GET', appPath()), 200).enabled, false);
					assert.equal(await runtime(), null);
					expectStatus(await f.api('GET', dataPath('runtime')), 403);
				},
			);
			await t.test('repeated install returns original identity and creates no duplicate App', async () => {
				assert.deepEqual(
					expectStatus(
						await f.api('POST', base + '/install', { stageId: staged.id, expectedVersion: staged.version }),
						200,
					),
					installation,
				);
				assert.equal(expectStatus(await f.api('GET', base + '/installations'), 200).items.length, 1);
			});
			await t.test(
				'enabling starts actual child module and signed sibling import with authenticated host storage',
				async () => {
					await setEnabled(true);
					const live = await ready(1, '1.0.0');
					assert.equal(JSON.parse(live.data.valueJson).marker, 'signed sibling');
					assert.ok((await readdir(f.database + '.modules')).length > 0);
				},
			);
			await t.test('descriptor grants only signed frontend bytes and finite SDK modules', async () => {
				descriptor = readAgentPluginDescriptor(
					expectStatus(await f.api('GET', installPath() + '/descriptor'), 200),
				);
				const asset = await f.anonymous('GET', descriptor.url);
				expectStatus(asset, 200);
				assert.equal(
					asset.bytes.toString('utf8'),
					'<!doctype html><title>isolated plugin</title><p>signed asset</p>',
				);
				assert.match(asset.headers['content-security-policy'], /sandbox allow-scripts/u);
				expectStatus(
					await f.anonymous('GET', descriptor.url.replace('/frontend/index.html', '/backend/main.mjs')),
					400,
				);
				const sdk = await f.anonymous('GET', '/sdk/frontend-v1.mjs');
				expectStatus(sdk, 200);
				assert.match(sdk.bytes.toString('utf8'), /import/u);
				expectStatus(
					await f.anonymous(
						'GET',
						descriptor.url.replace('/' + descriptor.url.split('/')[4] + '/', '/' + randomUUID() + '/'),
					),
					403,
				);
			});
			await t.test('plugin data writes replay current receipts and reject superseded receipts', async () => {
				const input = {
					expectedRevision: installation.revision,
					expectedVersion: 0,
					operationId: randomUUID(),
					valueJson: '{"count":1}',
				};
				initialData = readAgentPluginDataView(
					expectStatus(await f.api('PUT', dataPath('setting'), input), 200),
				);
				assert.equal(initialData.version, 1);
				assert.deepEqual(expectStatus(await f.api('PUT', dataPath('setting'), input), 200), initialData);
				const next = expectStatus(
					await f.api('PUT', dataPath('setting'), {
						...input,
						operationId: randomUUID(),
						expectedVersion: 1,
						valueJson: '{"count":2}',
					}),
					200,
				);
				assert.equal(next.version, 2);
				expectStatus(await f.api('PUT', dataPath('setting'), input), 409);
				assert.equal((await data('setting')).valueJson, '{"count":2}');
				expectStatus(await f.api('PUT', dataPath('setting'), { ...input, valueJson: '{"count":999}' }), 409);
			});
			await t.test('frontend RPC binds descriptor grant and correlates nonce/id/sequence', async () => {
				rpcRequest = {
					grant: descriptor.url.split('/')[4],
					envelope: {
						type: 'nexus.plugin.request',
						protocol: 1,
						nonce: randomUUID(),
						id: randomUUID(),
						seq: 1,
						request: { method: 'host.appInfo', params: {} },
					},
				};
				const response = expectStatus(await f.api('POST', installPath() + '/frontend/rpc', rpcRequest), 200);
				assert.equal(response.ok, true);
				assert.equal(response.nonce, rpcRequest.envelope.nonce);
				assert.equal(response.id, rpcRequest.envelope.id);
				assert.equal(response.seq, 1);
				assert.deepEqual(response.result.value, installation);
				const refused = expectStatus(
					await f.api('POST', installPath() + '/frontend/rpc', { ...rpcRequest, grant: randomUUID() }),
					403,
				);
				assert.equal(refused.ok, false);
				assert.equal(refused.id, rpcRequest.envelope.id);
				assert.equal(refused.error.code, 'forbidden');
			});
			await t.test('deleted data keeps monotonic tombstone and stale CAS cannot recreate old value', async () => {
				const original = await data('setting');
				const deleted = expectStatus(
					await f.api('DELETE', dataPath('setting'), {
						expectedRevision: installation.revision,
						expectedVersion: original.version,
						operationId: randomUUID(),
					}),
					200,
				);
				assert.equal(deleted.valueJson, null);
				assert.ok(deleted.version > original.version);
				expectStatus(
					await f.api('PUT', dataPath('setting'), {
						expectedRevision: installation.revision,
						expectedVersion: original.version,
						operationId: randomUUID(),
						valueJson: '"old"',
					}),
					409,
				);
				assert.equal((await data('setting')).valueJson, null);
			});
			await t.test(
				'disable closes actual runtime and invalidates descriptor; re-enable starts independent instance',
				async () => {
					const old = await runtime();
					const child = await childIdentity();
					await setEnabled(false);
					assert.equal((await runtime()).state, 'closed');
					await assertExited(child);
					expectStatus(await f.anonymous('GET', descriptor.url), 403);
					expectStatus(await f.api('POST', installPath() + '/frontend/rpc', rpcRequest), 403);
					expectStatus(await f.api('GET', dataPath('runtime')), 403);
					assert.deepEqual(await readdir(f.database + '.modules'), []);
					await setEnabled(true);
					const live = await ready(2, '1.0.0');
					assert.notEqual(live.runtime.instanceId, old.instanceId);
				},
			);
			await t.test(
				'real restart retains installation/data and activates enabled plugin with new instance',
				async () => {
					const old = await runtime();
					const child = await childIdentity();
					await f.restart();
					await assertExited(child);
					const live = await ready(3, '1.0.0');
					assert.notEqual(live.runtime.instanceId, old.instanceId);
					assert.deepEqual(expectStatus(await f.api('GET', base + '/installations'), 200).items, [
						installation,
					]);
				},
			);
			await t.test(
				'same definition/version with different signed bytes cannot replace immutable installed content',
				async () => {
					const other = await stage(await build('1.0.0', 'different content'));
					const checked = expectStatus(await verify(other), 200);
					expectStatus(
						await f.api('POST', base + '/install', {
							stageId: checked.id,
							expectedVersion: checked.version,
						}),
						409,
					);
					assert.equal(expectStatus(await f.api('GET', base + '/versions'), 200).items.length, 1);
				},
			);
			await t.test('new signed version can prepare upgrade and drain runtime before data migration', async () => {
				const next = await stage(await build('1.1.0'));
				upgraded = expectStatus(await verify(next), 200);
				const child = await childIdentity();
				installation = expectStatus(
					await f.api('POST', installPath() + '/prepare-upgrade', {
						expectedRevision: installation.revision,
						stageId: upgraded.id,
						expectedStageVersion: upgraded.version,
					}),
					200,
				);
				assert.equal(installation.status, 'draining');
				assert.equal((await runtime()).state, 'closed');
				await assertExited(child);
				assert.deepEqual(await readdir(f.database + '.modules'), []);
			});
			await t.test(
				'migration requires full original key/version snapshot and preserves failed input atomically',
				async () => {
					const snapshot = expectStatus(await f.api('GET', installPath() + '/data-snapshot'), 200);
					assert.ok(snapshot.items.some((item) => item.key === 'runtime'));
					const body = { expectedRevision: snapshot.revision, operationId: randomUUID(), items: [] };
					expectStatus(await f.api('POST', installPath() + '/migrate-data', body), 409);
					assert.deepEqual(expectStatus(await f.api('GET', installPath() + '/data-snapshot'), 200), snapshot);
					const migration = {
						expectedRevision: snapshot.revision,
						operationId: randomUUID(),
						items: snapshot.items.map((item) => ({
							key: item.key,
							expectedVersion: item.version,
							valueJson: item.valueJson,
						})),
					};
					const result = expectStatus(await f.api('POST', installPath() + '/migrate-data', migration), 200);
					assert.deepEqual(
						expectStatus(await f.api('POST', installPath() + '/migrate-data', migration), 200),
						result,
					);
					installation = expectStatus(await f.api('GET', base + '/installations'), 200).items[0];
					expectStatus(
						await f.api('POST', installPath() + '/cancel-retirement', {
							expectedRevision: installation.revision,
						}),
						409,
					);
				},
			);
			await t.test(
				'upgrade switches version while disabled, then actual activation consumes new version',
				async () => {
					installation = expectStatus(
						await f.api('POST', installPath() + '/upgrade', {
							expectedRevision: installation.revision,
							stageId: upgraded.id,
							expectedStageVersion: upgraded.version,
						}),
						200,
					);
					assert.equal(installation.version, '1.1.0');
					assert.equal(expectStatus(await f.api('GET', appPath()), 200).enabled, false);
					await setEnabled(true);
					await ready(4, '1.1.0');
				},
			);
			await t.test(
				'publisher revocation stops actual runtime and invalidates data/content; stale revocation fails',
				async () => {
					descriptor = expectStatus(await f.api('GET', installPath() + '/descriptor'), 200);
					const child = await childIdentity();
					expectStatus(
						await f.api('DELETE', base + '/publishers/' + publisher.keyId, {
							expectedVersion: publisher.version + 1,
						}),
						409,
					);
					publisher = expectStatus(
						await f.api('DELETE', base + '/publishers/' + publisher.keyId, {
							expectedVersion: publisher.version,
						}),
						200,
					);
					assert.ok(publisher.revokedAt !== null);
					assert.equal((await runtime()).state, 'closed');
					await assertExited(child);
					expectStatus(await f.api('GET', dataPath('runtime')), 403);
					expectStatus(await f.anonymous('GET', descriptor.url), 403);
					assert.deepEqual(await readdir(f.database + '.modules'), []);
				},
			);
			await t.test('removal reaches removed; explicit data purge result is idempotent', async () => {
				installation = expectStatus(
					await f.api('DELETE', installPath(), { expectedRevision: installation.revision }),
					200,
				);
				assert.equal(installation.status, 'removed');
				const input = { expectedRevision: installation.revision, operationId: randomUUID() };
				const purged = expectStatus(await f.api('POST', installPath() + '/delete-data', input), 200);
				assert.ok(purged.deletedKeys >= 1);
				assert.deepEqual(expectStatus(await f.api('POST', installPath() + '/delete-data', input), 200), purged);
			});
			await t.test('final restart never revives revoked publisher or removed plugin', async () => {
				await f.restart();
				assert.equal(expectStatus(await f.api('GET', base + '/installations'), 200).items[0].status, 'removed');
				assert.equal((await runtime()).state, 'closed');
				assert.deepEqual(await readdir(f.database + '.modules'), []);
			});
		} finally {
			await f?.close();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
