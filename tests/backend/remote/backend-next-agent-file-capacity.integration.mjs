import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { inspectSearch } from '../../../packages/backend/dist/modules/remote/files/service/file-inspection.js';
import { capturePath } from '../../../packages/backend/dist/modules/remote/files/service/file-snapshot.js';
import { writeInspectedText } from '../../../packages/backend/dist/modules/remote/files/service/file-write.js';
import {
	patchInspectedText,
	moveInspectedPath,
	deleteInspectedPath,
} from '../../../packages/backend/dist/modules/remote/files/service/file-mutation.js';
import { RemoteFileFailure } from '../../../packages/backend/dist/modules/remote/files/model/file-types.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Exercise the real service with actual files and byte streams. Resource translation
// is local to this fixture; no mock hashes, fake snapshots or shell-side mutations.
async function fixture() {
	const root = await mkdtemp(join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-file-capacity-'));
	const signal = new AbortController().signal;
	let streams = 0;
	let reads = 0;

	async function stat({ path }) {
		try {
			const info = await lstat(path);
			return {
				kind: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
				size: info.size,
				mode: info.mode,
				uid: info.uid,
				gid: info.gid,
				modifiedAt: info.mtimeMs,
			};
		} catch (error) {
			if (error.code === 'ENOENT') throw new RemoteFileFailure('not_found');
			throw error;
		}
	}

	const resource = {
		stat,

		realpath: ({ path }) => realpath(path),

		async listAfter({ path, after, maxEntries }) {
			// Deliberately shorter pages prove traversal does not mistake a byte-bound
			// page for EOF. The empty terminal page is the continuation boundary.
			const names = (await readdir(path))
				.filter((name) => name > after)
				.sort()
				.slice(0, Math.min(37, maxEntries));
			return Promise.all(names.map(async (name) => ({ name, info: await stat({ path: join(path, name) }) })));
		},

		async read({ path, start = 0, length, maxBytes }) {
			reads++;
			const bytes = await readFile(path);
			const result = bytes.subarray(start, length === undefined ? undefined : start + length);
			assert.ok(result.length <= maxBytes);
			return result;
		},

		async openRead({ path, maxBytes }) {
			streams++;
			assert.equal((await lstat(path)).size, maxBytes);
			return createReadStream(path, { highWaterMark: 16384 });
		},

		async stage({ path, bytes, mode }) {
			const temporary = join(dirname(path), '.capacity-' + randomUUID());
			await writeFile(temporary, bytes, { mode, flag: 'wx' });
			let committed = false;
			return {
				async commit() {
					await rename(temporary, path);
					committed = true;
				},

				async discard() {
					if (!committed) await unlink(temporary);
				},
			};
		},

		rename: ({ from, to }) => rename(from, to),

		remove: ({ path }) => unlink(path),

		rmdir: ({ path }) => rmdir(path),

		list: async ({ path }) =>
			Promise.all(
				(await readdir(path)).map(async (name) => ({ name, info: await stat({ path: join(path, name) }) })),
			),
	};
	return {
		root,
		context: {
			resource,
			signal,

			remaining: () => 60000,

			validate: async () => signal.throwIfAborted(),
		},

		counts: () => ({ streams, reads }),
	};
}

await test('Agent file capacity: long paths, large writes and patches retain exact hash preconditions', async () => {
	const f = await fixture();
	const directory = join(f.root, 'a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100));
	await mkdir(directory, { recursive: true });
	const path = join(directory, 'large.txt');
	assert.ok(Buffer.byteLength(path) > 256);
	const oldText = 'start-' + 'a'.repeat(12000) + '-end';
	const content = oldText + '\n' + 'body\n'.repeat(12000);
	const created = await writeInspectedText(f.context, { path, content, expectedSha256: 'absent' });
	assert.equal(created.sha256, hash(content));
	assert.equal(created.bytes, Buffer.byteLength(content));
	assert.equal(await readFile(path, 'utf8'), content);
	const replacement = 'replacement-' + 'z'.repeat(18000);
	const patched = await patchInspectedText(f.context, {
		path,
		expectedSha256: created.sha256,
		edits: [{ oldText, newText: replacement }],
	});
	const expected = replacement + content.slice(oldText.length);
	assert.equal(patched.sha256, hash(expected));
	assert.equal(await readFile(path, 'utf8'), expected);
	await assert.rejects(
		writeInspectedText(f.context, { path, content: 'stale', expectedSha256: created.sha256 }),
		(error) => error instanceof RemoteFileFailure && error.code === 'conflict',
	);
	assert.equal(await readFile(path, 'utf8'), expected);
	assert.deepEqual(await readdir(directory), ['large.txt'], 'all private stages retired');
});

await test('Agent file capacity: deep trees and streamed multi-MiB files traverse every directory page', async () => {
	const f = await fixture();
	const root = join(f.root, 'tree');
	const deep = join(root, ...Array.from({ length: 12 }, (_, index) => 'd' + index));
	await mkdir(deep, { recursive: true });
	await Promise.all(
		Array.from({ length: 240 }, (_, index) =>
			writeFile(join(root, 'f' + String(index).padStart(3, '0')), 'needle\n'),
		),
	);
	await writeFile(join(deep, 'large'), Buffer.alloc(3 * 1024 * 1024, 120));
	const snapshot = await capturePath(f.context, root);
	assert.equal(snapshot.fileCount, 241);
	assert.equal(snapshot.directoryCount, 13);
	assert.ok(snapshot.bytes > 2 * 1024 * 1024);
	assert.equal(f.counts().reads, 0, 'tree hashing never buffers complete files');
	assert.equal(f.counts().streams, 241);
	const facts = snapshot.nodes.map((node) => [
		node.relativePath,
		node.kind,
		node.info.size,
		node.info.mode,
		node.info.uid,
		node.info.gid,
		node.info.modifiedAt,
		node.contentSha256,
	]);
	assert.equal(snapshot.fingerprint, hash(JSON.stringify(facts)));
	assert.equal((await capturePath(f.context, root)).fingerprint, snapshot.fingerprint);
	const search = await inspectSearch(f.context, root, ['needle'], 300);
	assert.equal(search.matches.length, 240);
	assert.equal(search.truncated, false);
	assert.equal(new Set(search.matches.map((match) => basename(match.path))).size, 240);
	const limited = await inspectSearch(f.context, root, ['needle'], 150);
	assert.equal(limited.matches.length, 150);
	assert.equal(limited.truncated, true, 'the caller controls the result count');
	const destinationPath = join(f.root, 'moved');
	const moved = await moveInspectedPath(f.context, {
		path: root,
		destinationPath,
		expectedFingerprint: snapshot.fingerprint,
	});
	assert.equal(moved.fingerprint, snapshot.fingerprint);
	const deleted = await deleteInspectedPath(f.context, {
		path: destinationPath,
		scope: 'tree',
		expectedFingerprint: snapshot.fingerprint,
	});
	assert.equal(deleted.fileCount, 241);
	assert.deepEqual(await readdir(f.root), []);
});

await test('Agent directory capacity: actual SFTP resource pages long metadata without losing names', async () => {
	const { SftpFileResource } =
		await import('../../../packages/backend/dist/modules/remote/files/model/file-resource.js');
	const rows = Array.from({ length: 20 }, (_, index) => ({
		name: String(index).padStart(3, '0') + 'x'.repeat(240),
		info: {
			isSymbolicLink: false,
			isDirectory: false,
			isFile: true,
			size: 1,
			mode: 0o644,
			uid: 1,
			gid: 1,
			accessedAt: 1,
			modifiedAt: 1,
		},
	}));
	let scans = 0,
		closed = 0;
	const resource = new SftpFileResource(
		1,
		'fixture',
		{ isOpen: true },
		{
			async *scan() {
				scans++;
				yield* [...rows].reverse();
			},

			async close() {
				closed++;
			},
		},
		'fixture-server-key',
		async () => {},
	);
	const signal = new AbortController().signal;
	const names = [];
	let after = '';
	try {
		for (;;) {
			const page = await resource.listAfter({
				path: '/',
				after,
				maxEntries: 100,
				maxMetadataBytes: 1100,
				signal,
				timeoutMs: 1000,
			});
			assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1100);
			if (!page.length) break;
			assert.ok(page.length < 100);
			names.push(...page.map((item) => item.name));
			after = page.at(-1).name;
		}
		assert.deepEqual(
			names,
			rows.map((row) => row.name),
		);
		assert.ok(scans > 2);
		await assert.rejects(
			resource.listAfter({ path: '/', after: '', maxEntries: 100, maxMetadataBytes: 2, signal, timeoutMs: 1000 }),
			(error) => error.code === 'limit_exceeded',
		);
	} finally {
		await resource.close();
	}
	assert.equal(closed, 1);
});
