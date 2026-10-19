import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LocalSuspendedTerminalLog } from '../../../packages/backend/dist/platform/terminal/adapters/local-suspended-log.js';

const mib = 1024 * 1024;

async function fixture(t) {
	const directory = await fs.mkdtemp(join(tmpdir(), 'nexus-b10-suspended-log-'));
	const log = new LocalSuspendedTerminalLog(directory);
	t.after(async () => {
		try {
			await log.close();
		} finally {
			await fs.rm(directory, { recursive: true, force: true });
		}
	});
	return {
		directory,
		log,

		path: (id) => join(directory, 'temp_backend_next_suspended_ssh_logs', id + '.log'),
	};
}

async function digest(stream) {
	const hash = createHash('sha256');
	let bytes = 0;
	for await (const chunk of stream) {
		bytes += chunk.length;
		hash.update(chunk);
	}
	return { bytes, sha256: hash.digest('hex') };
}

function expected(first, last) {
	const hash = createHash('sha256');
	for (let index = first; index < last; index += 1) {
		hash.update(Buffer.alloc(mib, index));
	}
	return { bytes: (last - first) * mib, sha256: hash.digest('hex') };
}

await test('Actual suspended log compaction preserves absolute pages and pinned export inodes', async (t) => {
	const f = await fixture(t);
	for (let index = 0; index < 132; index += 1) {
		assert.equal(await f.log.append('history-0001', Buffer.alloc(mib, index)), (index + 1) * mib);
	}
	const pinned = await f.log.openRead('history-0001');
	t.after(() => pinned.destroy());
	for (let index = 132; index < 134; index += 1) {
		await f.log.append('history-0001', Buffer.alloc(mib, index));
	}
	assert.ok((await fs.stat(f.path('history-0001'))).size <= 132 * mib);
	assert.deepEqual(
		await digest(pinned),
		expected(32, 132),
		'compaction does not rewrite the already-open export inode',
	);
	let cursor = 134 * mib;
	let pages = 0;
	while (cursor > 34 * mib) {
		const page = await f.log.readBefore('history-0001', cursor, 256 * 1024);
		assert.equal(page.totalBytes, 134 * mib);
		assert.equal(page.oldestOffset, 34 * mib);
		assert.equal(page.endOffset, cursor);
		assert.equal(page.startOffset, cursor - 256 * 1024);
		assert.deepEqual(Buffer.from(page.data), Buffer.alloc(256 * 1024, Math.floor(page.startOffset / mib)));
		cursor = page.startOffset;
		pages += 1;
	}
	assert.equal(pages, 400);
	for (const before of [cursor, cursor - 1, 0]) {
		const page = await f.log.readBefore('history-0001', before, 256 * 1024);
		assert.equal(page.data.length, 0);
		assert.equal(page.startOffset, cursor);
		assert.equal(page.endOffset, cursor);
	}
	const beforeReplace = await f.log.openRead('history-0001');
	t.after(() => beforeReplace.destroy());
	assert.equal(await f.log.append('history-0001', Buffer.alloc(100 * mib, 201)), 234 * mib);
	assert.deepEqual(
		await digest(beforeReplace),
		expected(34, 134),
		'whole-window replacement also preserves an already-open inode',
	);
	const tail = await f.log.readTail('history-0001', 256 * 1024);
	assert.equal(tail.oldestOffset, 134 * mib);
	assert.equal(tail.totalBytes, 234 * mib);
	assert.deepEqual(Buffer.from(tail.data), Buffer.alloc(256 * 1024, 201));
	await f.log.delete('history-0001');
	await assert.rejects(fs.stat(f.path('history-0001')), { code: 'ENOENT' });
});

await test('Concurrent real log deletion shares failure and blocks appending until its owner settles', async (t) => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	// Release before the fixture tries to drain the same writer during failed-assertion cleanup.
	t.after(() => release());
	const f = await fixture(t);
	await f.log.append('history-0002', Buffer.from('original bytes'));
	const remove = fs.rm;
	const failure = new Error('controlled filesystem delete refusal');
	let calls = 0;
	t.mock.method(fs, 'rm', async (path, options) => {
		if (path === f.path('history-0002')) {
			calls += 1;
			await gate;
			throw failure;
		}
		return remove(path, options);
	});
	t.after(() => {
		release();
		t.mock.restoreAll();
	});
	const first = f.log.delete('history-0002').then(
		(value) => ({ value }),
		(error) => ({ error }),
	);
	const second = f.log.delete('history-0002').then(
		(value) => ({ value }),
		(error) => ({ error }),
	);
	await assert.rejects(f.log.append('history-0002', Buffer.from('must not append')));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(calls, 1);
	release();
	for (const result of await Promise.all([first, second])) {
		assert.strictEqual(result.error, failure);
	}
	assert.equal(await fs.readFile(f.path('history-0002'), 'utf8'), 'original bytes');
	await assert.rejects(f.log.flush('history-0002'), (error) => error === failure);
	t.mock.restoreAll();
	await f.log.delete('history-0002');
	await f.log.append('history-0002', Buffer.from('explicit new log'));
	assert.equal(await fs.readFile(f.path('history-0002'), 'utf8'), 'explicit new log');
});

await test('Actual log short read rejects without poisoning independent history', async (t) => {
	const f = await fixture(t);
	await f.log.append('history-0003', Buffer.from('expected complete history'));
	await fs.truncate(f.path('history-0003'), 4);
	await assert.rejects(f.log.readTail('history-0003', 256 * 1024));
	await f.log.append('history-0004', Buffer.from('healthy independent history'));
	assert.equal(
		Buffer.from((await f.log.readTail('history-0004', 256 * 1024)).data).toString(),
		'healthy independent history',
	);
	await f.log.delete('history-0003');
});

await test('An actual append filesystem refusal poisons only its log until explicit deletion', async (t) => {
	const f = await fixture(t);
	const id = 'history-0005';
	await f.log.append(id, Buffer.from('confirmed original history'));
	const original = f.path(id) + '.original';
	await fs.rename(f.path(id), original);
	await fs.mkdir(f.path(id));
	const failure = await f.log.append(id, Buffer.from('unconfirmed bytes')).then(
		() => assert.fail('The actual append must fail'),
		(error) => error,
	);
	assert.equal(failure.code, 'EISDIR');
	for (const operation of [
		() => f.log.append(id, Buffer.from('must not retry')),
		() => f.log.position(id),
		() => f.log.readTail(id, 1024),
		() => f.log.openRead(id),
		() => f.log.flush(id),
	]) {
		await assert.rejects(operation(), (error) => error === failure);
	}
	assert.equal(await fs.readFile(original, 'utf8'), 'confirmed original history');
	await f.log.append('history-0006', Buffer.from('independent healthy writer'));
	assert.equal(
		Buffer.from((await f.log.readTail('history-0006', 1024)).data).toString(),
		'independent healthy writer',
	);
	await fs.rmdir(f.path(id));
	await fs.rename(original, f.path(id));
	await f.log.delete(id);
	assert.equal(await f.log.append(id, Buffer.from('explicit replacement history')), 28);
});

for (const kind of ['replace', 'trim']) {
	await test(
		'Actual ' + kind + ' rename refusal preserves the old inode and removes its temporary file',
		async (t) => {
			const f = await fixture(t);
			const id = 'history-' + kind;
			const file = f.path(id);
			const backup = file + '.original';
			const rename = fs.rename;
			if (kind === 'trim') {
				for (let index = 0; index < 132; index += 1) {
					await f.log.append(id, Buffer.alloc(mib, index));
				}
			} else {
				await f.log.append(id, Buffer.from('confirmed before full replacement'));
			}
			const pinned = await f.log.openRead(id);
			t.after(() => pinned.destroy());
			let attempted = 0;
			t.mock.method(fs, 'rename', async (source, destination) => {
				if (destination === file && source.includes('.' + kind + '-')) {
					attempted += 1;
					await rename(file, backup);
					await fs.mkdir(file);
				}
				return rename(source, destination);
			});
			const failure = await f.log.append(id, Buffer.alloc(kind === 'trim' ? mib : 100 * mib, 211)).then(
				() => assert.fail('The actual rename must fail'),
				(error) => error,
			);
			assert.equal(failure.code, 'EISDIR');
			assert.equal(attempted, 1);
			assert.equal(
				(await fs.readdir(join(f.directory, 'temp_backend_next_suspended_ssh_logs'))).some((name) =>
					name.includes('.' + kind + '-'),
				),
				false,
			);
			const actual = await digest(pinned);
			const prior =
				kind === 'trim'
					? expected(32, 132)
					: {
							bytes: 33,
							sha256: createHash('sha256').update('confirmed before full replacement').digest('hex'),
						};
			assert.deepEqual(actual, prior);
			await assert.rejects(f.log.flush(id), (error) => error === failure);
			await fs.rmdir(file);
			await rename(backup, file);
			await f.log.delete(id);
		},
	);
}
