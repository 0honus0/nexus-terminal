import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openImageFixture } from './agent-image-fixture.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

await test(
	'Images Run and approved image tool preserve preview, download and file management',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(join(tmpdir(), 'nexus-image-acceptance-'));
		const f = await openImageFixture(directory);
		try {
			for (const model of ['gpt-image-2.5', 'text-model']) {
				await t.test(model, async () => {
					const count = f.calls.filter((call) => call.path.endsWith('/generations')).length;
					const { thread, run } = await f.start(model);
					if (model === 'text-model') {
						const approval = await f.approval(run);
						assert.equal(approval.inspection.toolName, 'image_generate');
						assert.equal(f.calls.filter((call) => call.path.endsWith('/generations')).length, count);
						await f.approve(approval);
					}
					await f.wait(run, 'completed');
					assert.equal(f.calls.filter((call) => call.path.endsWith('/generations')).length, count + 1);
					const text = (await f.entries(thread)).items
						.filter((entry) => entry.role === 'assistant')
						.map((entry) => entry.text)
						.join('');
					const preview = text.match(/!\[Generated image\]\(([^)]+)\)/)?.[1];
					const download = text.match(/\[Download image\]\(([^)]+)\)/)?.[1];
					assert.ok(preview?.endsWith('/preview'), text);
					assert.equal(download, preview.replace(/preview$/, 'content'));
					const image = await f.api('GET', preview);
					assert.equal(image.status, 200);
					assert.equal(image.headers['content-type'], 'image/png');
					assert.match(image.headers['content-disposition'], /^inline/);
					assert.equal(image.headers['cache-control'], 'private, no-store');
					assert.equal(image.headers['x-content-type-options'], 'nosniff');
					assert.equal(hash(image.bytes), hash(f.png));
					const file = await f.api('GET', download);
					assert.equal(file.status, 200);
					assert.equal(file.headers['content-type'], 'application/octet-stream');
					assert.match(file.headers['content-disposition'], /^attachment/);
					assert.equal(hash(file.bytes), hash(f.png));
					const partial = await f.api('GET', preview, undefined, { Range: 'bytes=0-7' });
					assert.equal(partial.status, 206);
					assert.deepEqual(partial.bytes, f.png.subarray(0, 8));
					assert.equal((await f.api('GET', preview, undefined, { Cookie: '' })).status, 401);
					const otherApp = expectStatus(
						await f.api('POST', '/api/v1/agent/apps', { name: 'Other image scope' }),
						201,
					);
					assert.equal((await f.api('GET', preview.replace(f.appId, otherApp.id))).status, 404);
					const path = preview.replace(/\/preview$/, '');
					const listed = expectStatus(await f.api('GET', f.base + '/artifacts'), 200).items;
					let artifact = listed.find((item) => path.endsWith('/' + item.id));
					assert.equal(artifact.status, 'ready');
					assert.equal(artifact.sha256, hash(f.png));
					artifact = expectStatus(
						await f.api('PATCH', path + '/retain', { expectedVersion: artifact.version, retained: true }),
						200,
					).artifact;
					assert.equal(artifact.retained, true);
					expectStatus(
						await f.api('PATCH', path + '/retain', {
							expectedVersion: artifact.version - 1,
							retained: false,
						}),
						409,
					);
					const summary = expectStatus(await f.api('GET', '/api/v1/agent/files/storage'), 200).storage;
					assert.ok(summary.retainedBytes >= f.png.byteLength);
					expectStatus(await f.api('DELETE', path, { expectedVersion: artifact.version }), 409);
					artifact = expectStatus(
						await f.api('PATCH', path + '/retain', { expectedVersion: artifact.version, retained: false }),
						200,
					).artifact;
					expectStatus(await f.api('DELETE', path, { expectedVersion: artifact.version }), 200);
					assert.equal((await f.api('GET', preview)).status, 404);
					assert.equal((await f.api('GET', download)).status, 404);
				});
			}
			await t.test('ordinary HTML files cannot use the inline image preview route', async () => {
				const bytes = Buffer.from('<html><script>throw new Error("must not run")</script></html>');
				let artifact = expectStatus(
					await f.api('POST', f.base + '/artifacts', {
						name: 'not-an-image.html',
						mediaType: 'text/html',
						declaredBytes: bytes.length,
					}),
					201,
				).artifact;
				const path = f.base + '/artifacts/' + artifact.id;
				artifact = expectStatus(
					await f.api('PUT', path + '/content', bytes, {
						'Content-Type': 'application/octet-stream',
						'If-Match': '"' + artifact.version + '"',
					}),
					200,
				).artifact;
				assert.equal((await f.api('GET', path + '/preview')).status, 404);
				const download = await f.api('GET', path + '/content');
				assert.equal(download.status, 200);
				assert.equal(download.headers['content-type'], 'application/octet-stream');
				assert.match(download.headers['content-disposition'], /^attachment/);
				assert.deepEqual(download.bytes, bytes);
				expectStatus(await f.api('DELETE', path, { expectedVersion: artifact.version }), 200);
			});
			await t.test('URL-only provider result is unknown and is never fetched or retried', async () => {
				f.setImageMode('url');
				const count = f.calls.length;
				const { run } = await f.start();
				await f.wait(run, 'unknown');
				assert.equal(f.calls.length, count + 1);
				assert.equal(expectStatus(await f.api('GET', f.base + '/artifacts'), 200).items.length, 0);
			});
			await t.test('cancelled in-flight image request publishes no file and does not retry', async () => {
				f.setImageMode('hold');
				const count = f.calls.length;
				const { run } = await f.start();
				await until(
					async () => f.calls.length,
					(value) => value === count + 1,
					'image dispatched',
				);
				const current = expectStatus(await f.api('GET', f.base + '/runs/' + run.id), 200);
				expectStatus(
					await f.api(
						'POST',
						f.base + '/runs/' + run.id + '/cancel',
						{ expectedVersion: current.version },
						{ 'Idempotency-Key': randomUUID() },
					),
					200,
				);
				await f.wait(run, 'cancelled');
				assert.equal(f.calls.length, count + 1);
				assert.equal(expectStatus(await f.api('GET', f.base + '/artifacts'), 200).items.length, 0);
			});
		} finally {
			await f.close();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
