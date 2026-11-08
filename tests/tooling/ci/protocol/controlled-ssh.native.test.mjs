import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '../../../../packages/backend/node_modules/ssh2/lib/index.js';
import { openControlledSsh } from '../../../support/protocols/controlled-ssh-fixture.mjs';

async function closeLiveOutput(peer, kind) {
	const client = new Client();
	const closed = new Promise((resolve) => client.once('close', resolve));
	try {
		await new Promise((resolve, reject) => {
			client.once('ready', resolve);
			client.once('error', reject);
			client.connect({ host: peer.host, port: peer.port, username: peer.username, password: peer.password });
		});
		const command =
			"printf 'CLOSE_LIVE_OUTPUT\\n'; head -c 3145728 /dev/zero >&2 & head -c 3145728 /dev/zero; wait";
		const stream = await new Promise((resolve, reject) => {
			const accept = (error, stream) => (error ? reject(error) : resolve(stream));

			if (kind === 'shell') client.shell(accept);
			else client.exec(command, accept);
		});
		const channelClosed = new Promise((resolve) => stream.once('close', resolve));
		let started = false;
		let output = '';
		let errorBytes = 0;

		const closeAfterOutput = () => {
			if (started) return;
			if (output.includes('CLOSE_LIVE_OUTPUT\n') && errorBytes > 0) {
				started = true;
				stream.close();
			}
		};

		stream.on('data', (bytes) => {
			if (!started) output += bytes.toString();
			closeAfterOutput();
		});
		stream.stderr.on('data', (bytes) => {
			errorBytes += bytes.length;
			closeAfterOutput();
		});
		if (kind === 'shell') stream.write(command + '\n');
		await channelClosed;
		assert.equal(started, true, 'Close the actual producer after its output starts: ' + kind);
	} finally {
		client.end();
		await closed;
	}
}

async function readSeed(peer) {
	const client = new Client();
	const closed = new Promise((resolve) => client.once('close', resolve));
	try {
		await new Promise((resolve, reject) => {
			client.once('ready', resolve);
			client.once('error', reject);
			client.connect({ host: peer.host, port: peer.port, username: peer.username, password: peer.password });
		});
		return await new Promise((resolve, reject) =>
			client.sftp((error, sftp) => {
				if (error) {
					reject(error);
					return;
				}
				sftp.readFile('/seed.txt', (error, bytes) => (error ? reject(error) : resolve(bytes.toString())));
			}),
		);
	} finally {
		client.end();
		await closed;
	}
}

test(
	'controlled SSH peers isolate ports, files, offline recovery and concurrent shutdown',
	{ timeout: 60_000 },
	async (t) => {
		const directory = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'ssh-isolation-'));
		const first = await openControlledSsh(join(directory, 'first'));
		t.after(() => first.close());
		const second = await openControlledSsh(join(directory, 'second'));
		t.after(() => second.close());
		const ports = [first, second].flatMap((peer) => [peer.port, peer.controlPort, peer.transferTargetPort]);
		assert.equal(new Set(ports).size, ports.length);
		await writeFile(join(first.root, 'seed.txt'), 'first isolated root');
		await writeFile(join(second.root, 'seed.txt'), 'second isolated root');
		assert.deepEqual(await Promise.all([readSeed(first), readSeed(second)]), [
			'first isolated root',
			'second isolated root',
		]);
		assert.equal((await fetch(first.controlUrl + '/ssh/offline', { method: 'POST' })).status, 204);
		assert.equal(await readSeed(second), 'second isolated root');
		assert.equal((await fetch(first.controlUrl + '/ssh/online', { method: 'POST' })).status, 204);
		assert.equal(await readSeed(first), 'first isolated root');
		for (const kind of ['shell', 'exec']) {
			await closeLiveOutput(first, kind);
		}
		const closing = first.close();
		assert.equal(first.close(), closing);
		await closing;
		assert.equal(await readSeed(second), 'second isolated root');
		const otherClosing = second.close();
		assert.equal(second.close(), otherClosing);
		await otherClosing;
	},
);
