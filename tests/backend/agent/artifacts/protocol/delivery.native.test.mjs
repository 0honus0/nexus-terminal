import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { openPlugins } from '../../plugins/support/plugin-management-fixture.mjs';
import { expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
	'base64',
);

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

await test('Artifact HTTP delivery isolates Apps, protects inline types, and enforces retention CAS', async (t) => {
	const f = await openPlugins((close) => t.after(close));
	const base = '/api/v1/agent/apps/' + f.source.id + '/artifacts';
	const other = await f.install('artifact-other-app', { frontend: false });

	async function upload(name, mediaType, bytes) {
		let artifact = expectStatus(
			await f.api('POST', base, { name, mediaType, declaredBytes: bytes.length }),
			201,
		).artifact;
		artifact = expectStatus(
			await f.api('PUT', base + '/' + artifact.id + '/content', bytes, {
				'Content-Type': 'application/octet-stream',
				'If-Match': '"' + artifact.version + '"',
			}),
			200,
		).artifact;
		return artifact;
	}

	let artifact = await upload('image.png', 'image/png', png);
	const path = base + '/' + artifact.id;
	assert.equal(artifact.status, 'ready');
	assert.equal(artifact.sha256, hash(png));
	const preview = await f.api('GET', path + '/preview');
	assert.equal(preview.status, 200);
	assert.equal(preview.headers['content-type'], 'image/png');
	assert.match(preview.headers['content-disposition'], /^inline/);
	assert.equal(preview.headers['cache-control'], 'private, no-store');
	assert.equal(preview.headers['x-content-type-options'], 'nosniff');
	assert.equal(hash(preview.bytes), hash(png));
	const download = await f.api('GET', path + '/content');
	assert.equal(download.status, 200);
	assert.equal(download.headers['content-type'], 'application/octet-stream');
	assert.match(download.headers['content-disposition'], /^attachment/);
	assert.equal(hash(download.bytes), hash(png));
	const partial = await f.api('GET', path + '/preview', undefined, { Range: 'bytes=0-7' });
	assert.equal(partial.status, 206);
	assert.deepEqual(partial.bytes, png.subarray(0, 8));
	expectStatus(await f.api('GET', path + '/preview', undefined, { Cookie: '' }), 401);
	expectStatus(await f.api('GET', path.replace(f.source.id, other.appId) + '/preview'), 404);
	assert.ok(expectStatus(await f.api('GET', base), 200).items.some((item) => item.id === artifact.id));
	artifact = expectStatus(
		await f.api('PATCH', path + '/retain', { expectedVersion: artifact.version, retained: true }),
		200,
	).artifact;
	assert.equal(artifact.retained, true);
	expectStatus(
		await f.api('PATCH', path + '/retain', { expectedVersion: artifact.version - 1, retained: false }),
		409,
	);
	assert.ok(expectStatus(await f.api('GET', '/api/v1/agent/files/storage'), 200).storage.retainedBytes >= png.length);
	expectStatus(await f.api('DELETE', path, { expectedVersion: artifact.version }), 409);
	artifact = expectStatus(
		await f.api('PATCH', path + '/retain', { expectedVersion: artifact.version, retained: false }),
		200,
	).artifact;
	expectStatus(await f.api('DELETE', path, { expectedVersion: artifact.version }), 200);
	expectStatus(await f.api('GET', path + '/preview'), 404);
	expectStatus(await f.api('GET', path + '/content'), 404);

	const html = Buffer.from('<html><script>throw new Error("must not run")</script></html>');
	const htmlArtifact = await upload('not-an-image.html', 'text/html', html);
	const htmlPath = base + '/' + htmlArtifact.id;
	expectStatus(await f.api('GET', htmlPath + '/preview'), 404);
	const htmlDownload = await f.api('GET', htmlPath + '/content');
	assert.equal(htmlDownload.status, 200);
	assert.equal(htmlDownload.headers['content-type'], 'application/octet-stream');
	assert.match(htmlDownload.headers['content-disposition'], /^attachment/);
	assert.deepEqual(htmlDownload.bytes, html);
	expectStatus(await f.api('DELETE', htmlPath, { expectedVersion: htmlArtifact.version }), 200);
});
