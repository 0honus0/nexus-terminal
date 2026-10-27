import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { until } from './openssh-fixture.mjs';
import { fileHandles, remoteFilesFixture, transferEvent } from './file-transfer-fixture.mjs';

async function prefix(path, length) {
	const file = await open(path, 'r');
	try {
		const bytes = Buffer.alloc(length);
		const read = await file.read(bytes, 0, length, 0);
		assert.equal(read.bytesRead, length);
		return bytes;
	} finally {
		await file.close();
	}
}

await test('B10 real cross-Workspace copy cancellation and either owner closing', async (t) => {
	for (const mode of ['cancel', 'source-close', 'destination-close']) {
		await t.test(mode, async (t) => {
			const f = await remoteFilesFixture(t);
			const source = await f.endpoint('source');
			const destination = await f.endpoint('destination');
			const sourcePath = join(source.root, 'source.bin');
			const destinationPath = join(destination.root, 'source.bin');
			const original = Buffer.from('existing destination');
			const healthPath = join(f.directory, 'health.txt');
			await writeFile(healthPath, original);
			const bytes = randomBytes(512 * 1024);
			const file = await open(sourcePath, 'w');
			try {
				await file.truncate(128 * 1024 * 1024);
				await file.write(bytes, 0, bytes.length, 0);
			} finally {
				await file.close();
			}
			await writeFile(destinationPath, original);
			const requestId = randomUUID();
			const started = await destination.workspace.call(
				'transfer.copyMove',
				{
					mode: 'copy',
					sources: [sourcePath],
					destination: destination.root,
					sourceWorkspaceId: source.connection.workspaceId,
				},
				requestId,
			);
			assert.equal(started.ok, true, JSON.stringify(started));
			const progress = await transferEvent(destination.workspace, 'transfer.copyMove', requestId, [
				'progress',
				'failed',
				'completed',
			]);
			assert.equal(progress.payload.type, 'progress', JSON.stringify(progress));
			assert.ok(progress.payload.transferredBytes >= bytes.length);
			const stages = (await readdir(destination.root)).filter((name) => name.startsWith('.nexus-upload-'));
			assert.equal(stages.length, 1);
			const stage = join(destination.root, stages[0]);
			assert.deepEqual(await prefix(stage, bytes.length), bytes);
			assert.ok((await fileHandles(stage)).length > 0, 'the actual SFTP writer is still active');
			f.state.allowUnknownShutdown = true;
			if (mode === 'cancel') {
				const response = await destination.workspace.call('transfer.cancel', { taskId: requestId });
				assert.equal(response.ok, true, JSON.stringify(response));
				assert.equal(response.data, true);
			} else {
				const response = await f.close(mode === 'source-close' ? source : destination);
				assert.equal(response.ok, false, JSON.stringify(response));
				assert.equal(response.error, 'operation_unknown');
			}
			if (mode !== 'destination-close') {
				const terminal = await transferEvent(destination.workspace, 'transfer.copyMove', requestId, [
					'failed',
					'cancelled',
					'completed',
				]);
				assert.equal(terminal.payload.type, 'failed', JSON.stringify(terminal));
				assert.equal(terminal.payload.message, 'operation_unknown');
			}
			await until(
				() => fileHandles(stage),
				(holders) => holders.length === 0,
				'Copy stage writer closed',
			);
			assert.deepEqual(await readFile(destinationPath), original);
			assert.deepEqual(await prefix(sourcePath, bytes.length), bytes);
			assert.equal((await stat(sourcePath)).size, 128 * 1024 * 1024);
			assert.ok((await stat(stage)).size < 128 * 1024 * 1024, 'cancellation interrupts the actual large copy');
			const healthy = mode === 'source-close' ? destination : source;
			assert.deepEqual(await healthy.workspace.read(healthPath, 1024), original);
			const peer = await f.connect(destination.target);
			const refused = await peer.workspace.call('filesystem.createDirectory', {
				path: join(destination.root, 'must-not-exist'),
			});
			assert.equal(refused.ok, false, JSON.stringify(refused));
			assert.equal(refused.error, 'conflict', 'unconfirmed copy fences the destination endpoint');
			await assert.rejects(stat(join(destination.root, 'must-not-exist')), { code: 'ENOENT' });
		});
	}

	await t.test('independent healthy endpoints copy exact bytes and close normally', async (t) => {
		const f = await remoteFilesFixture(t);
		const source = await f.endpoint('healthy-source');
		const destination = await f.endpoint('healthy-destination');
		const bytes = randomBytes(64 * 1024);
		const sourcePath = join(source.root, 'healthy.bin');
		await writeFile(sourcePath, bytes);
		await destination.workspace.copyMove({
			mode: 'copy',
			sources: [sourcePath],
			destination: destination.root,
			sourceWorkspaceId: source.connection.workspaceId,
		});
		assert.deepEqual(await readFile(join(destination.root, 'healthy.bin')), bytes);
		assert.deepEqual(await destination.workspace.read(join(destination.root, 'healthy.bin'), bytes.length), bytes);
		assert.equal((await f.close(source)).ok, true);
		assert.equal((await f.close(destination)).ok, true);
	});
});
