import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { until } from './openssh-fixture.mjs';
import { fileHandles, remoteFilesFixture, transferEvent } from './file-transfer-fixture.mjs';

await test('B10 real native archive cancellation and Workspace closure', async (t) => {
	for (const mode of ['cancel', 'workspace-close']) {
		await t.test(mode, async (t) => {
			const f = await remoteFilesFixture(t);
			const owner = await f.endpoint('archive');
			const sourcePath = join(owner.root, 'source.bin');
			const destination = join(owner.root, 'existing.tar.bz2');
			const bytes = randomBytes(32 * 1024 * 1024);
			const original = Buffer.from('original archive destination');
			await writeFile(sourcePath, bytes);
			await writeFile(destination, original);
			const requestId = randomUUID();
			assert.equal(
				(
					await owner.workspace.call(
						'transfer.compress',
						{
							sources: [sourcePath],
							destination,
							format: 'tar.bz2',
						},
						requestId,
					)
				).ok,
				true,
			);
			const stage = await until(
				async () => {
					for (const name of await readdir(owner.root)) {
						if (name.startsWith('.nexus-archive-') && name.endsWith('.part.tar.bz2')) {
							const path = join(owner.root, name);
							if ((await stat(path)).size > 0 && (await fileHandles(path)).length > 0) {
								return path;
							}
						}
					}
					return null;
				},
				Boolean,
				'Actual archive bytes and live native producer',
			);
			f.state.allowUnknownShutdown = true;
			if (mode === 'cancel') {
				const cancelled = await owner.workspace.call('transfer.cancelArchive', { taskId: requestId });
				assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
				assert.equal(cancelled.data, true);
				const event = await transferEvent(owner.workspace, 'transfer.archive', requestId, [
					'failed',
					'cancelled',
					'completed',
				]);
				assert.equal(event.payload.type, 'failed', JSON.stringify(event));
				assert.equal(event.payload.message, 'operation_unknown');
				const read = await owner.workspace.call('filesystem.stat', { path: sourcePath });
				assert.equal(read.ok, true, JSON.stringify(read));
			} else {
				const closed = await f.close(owner);
				assert.equal(closed.ok, true, JSON.stringify(closed));
			}
			// A local cancellation does not promise the native process stopped; observe its real exit before fixture cleanup.
			await until(
				() => fileHandles(stage),
				(holders) => holders.length === 0,
				'Native archive writer eventually exits',
			);
			assert.deepEqual(await readFile(destination), original);
			assert.deepEqual(await readFile(sourcePath), bytes);
			assert.ok((await stat(stage)).size > 0, 'the unconfirmed private archive is retained');
			const peer = await f.connect(owner.target);
			const refused = await peer.workspace.call('filesystem.createDirectory', {
				path: join(owner.root, 'must-not-exist'),
			});
			assert.equal(refused.ok, false, JSON.stringify(refused));
			assert.equal(refused.error, 'conflict');
		});
	}

	await t.test('a fresh endpoint still compresses and publishes normally', async (t) => {
		const f = await remoteFilesFixture(t);
		const owner = await f.endpoint('healthy');
		const source = join(owner.root, 'healthy.txt');
		const destination = join(owner.root, 'healthy.zip');
		await writeFile(source, 'normal archive');
		const event = await owner.workspace.archive('transfer.compress', {
			sources: [source],
			destination,
			format: 'zip',
		});
		assert.equal(event.payload.type, 'completed', JSON.stringify(event));
		assert.ok((await stat(destination)).size > 0);
		assert.equal((await f.close(owner)).ok, true);
	});
});
