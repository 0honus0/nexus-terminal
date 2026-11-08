import assert from 'node:assert/strict';
import { test } from 'vitest';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import { Header, Pax } from '../../../../../packages/backend/node_modules/tar/dist/esm/index.js';
import { NativePackageReader } from '../../../../../packages/backend/src/platform/packages/adapters/native-package-reader.ts';
import { PackageFailure } from '../../../../../packages/backend/src/platform/packages/package-reader.ts';

function archive(path, text = 'content', type = 'File') {
	const bytes = Buffer.from(text);
	const header = new Header({ path, mode: 0o644, uid: 0, gid: 0, size: bytes.length, type });
	header.encode();
	return Buffer.concat([header.block, bytes, Buffer.alloc(((512 - (bytes.length % 512)) % 512) + 1024)]);
}

const limits = { maxArchiveBytes: 16384, maxEntries: 10, maxExpandedBytes: 1024, maxFileBytes: 1024 };

const failure = (kind) => (error) => error instanceof PackageFailure && error.kind === kind;

test('package paths reject dot segments and allow a normal archive root entry', async () => {
	const reader = new NativePackageReader();
	await assert.rejects(reader.read(archive('folder/./target'), limits), failure('invalid_archive'));
	assert.deepEqual(await reader.read(archive('.', '', 'Directory'), limits), []);
});

test('package paths support deeper valid assets within the supplied byte budgets', async () => {
	const path = 'a/'.repeat(40) + 'entry.mjs';
	const files = await new NativePackageReader().read(archive(path), limits);
	assert.equal(files.length, 1);
	assert.equal(files[0].path, path);
	assert.equal(Buffer.from(files[0].bytes).toString(), 'content');
});

test('caller archive and payload budgets apply independently without unrelated fixed ceilings', async () => {
	const reader = new NativePackageReader();
	const bytes = archive('entry.mjs');
	await assert.rejects(
		reader.read(bytes, { ...limits, maxArchiveBytes: bytes.length - 1 }),
		failure('limit_exceeded'),
	);
	await assert.rejects(reader.read(bytes, { ...limits, maxFileBytes: 3 }), failure('limit_exceeded'));
	await assert.rejects(reader.read(bytes, { ...limits, maxExpandedBytes: 3 }), failure('limit_exceeded'));
	assert.equal(
		(
			await reader.read(bytes, {
				...limits,
				maxEntries: 10001,
				maxExpandedBytes: 201 * 1024 * 1024,
				maxFileBytes: 51 * 1024 * 1024,
			})
		).length,
		1,
	);
});

test('inert archive paths and metadata follow the whole archive budget without separate arbitrary caps', async () => {
	const reader = new NativePackageReader();
	for (const path of ['segment/'.repeat(600) + 'entry.mjs', 'a'.repeat(66_000)]) {
		const bytes = Buffer.concat([new Pax({ path }).encode(), archive('pax-target')]);
		const files = await reader.read(bytes, { ...limits, maxArchiveBytes: 128 * 1024 });
		assert.equal(files[0].path, path);
		assert.equal(Buffer.from(files[0].bytes).toString(), 'content');
	}
});

test('supported compression is expanded once and the complete container remains bounded', async () => {
	const reader = new NativePackageReader();
	const bytes = archive('entry.mjs');
	for (const compress of [gzipSync, zstdCompressSync]) {
		assert.equal((await reader.read(compress(bytes), limits))[0].path, 'entry.mjs');
		await assert.rejects(reader.read(compress(gzipSync(bytes)), limits), failure('invalid_archive'));
		const metadata = Buffer.concat([new Pax({ comment: 'x'.repeat(2 * 1024 * 1024) }).encode(), bytes]);
		await assert.rejects(reader.read(compress(metadata), limits), failure('limit_exceeded'));
	}
});
