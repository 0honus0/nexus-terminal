import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeArchiveCommands } from '../../../../../packages/backend/dist/platform/archive/adapters/native/archive-commands.js';

function execute(command, args, signal) {
	return new Promise((resolve, reject) => {
		execFile(command, args, { signal }, (error, stdout, stderr) => {
			if (error && typeof error.code !== 'number') return reject(error);
			resolve({ code: error?.code ?? 0, stdout, stderr });
		});
	});
}

const subject = new NativeArchiveCommands({
	async executeLines(command, signal, _timeoutMs, onLine) {
		const result = await execute('sh', ['-c', command], signal);
		for (const line of result.stdout.split('\n').filter(Boolean)) onLine(line);
		return result.code === 0 ? { status: 'completed' } : { status: 'nonzero', exitCode: result.code };
	},
});

test('encrypted ZIP rejects a wrong password even when its header check collides', { timeout: 60_000 }, async (t) => {
	const directory = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'archive-password-'));
	const snapshot = fileURLToPath(
		new URL('../../../../fixtures/archives/zipcrypto-header-collision.zip', import.meta.url),
	);
	// This fixed vector passes ZipCrypto's one-byte password-header check. Info-ZIP
	// then rejects the payload with exit 2, rather than the usual password exit 82.
	const raw = await execute('unzip', ['-tq', '-P', 'incorrect-89', '--', snapshot], t.signal);
	assert.equal(raw.code, 2);
	assert.match(raw.stdout, /invalid compressed data/u);
	const stage = join(directory, 'extracted');
	const plan = { snapshot, stage, format: 'zip', excludedMembers: [], hasContent: true };
	const refused = await subject.extract(
		plan,
		() => 60_000,
		t.signal,
		() => undefined,
		'incorrect-89',
	);
	assert.deepEqual(refused, { outcome: { status: 'rejected', reason: 'invalid_password' }, done: false });
	await assert.rejects(stat(stage), { code: 'ENOENT' });
	const extracted = await subject.extract(
		plan,
		() => 60_000,
		t.signal,
		() => undefined,
		'fixture-correct-password',
	);
	assert.deepEqual(extracted, { outcome: { status: 'completed' }, done: true });
	assert.equal(
		await readFile(join(stage, 'source.txt'), 'utf8'),
		'CRC evidence for a wrong ZipCrypto password\n'.repeat(100),
	);
});

test('a damaged unencrypted ZIP is not classified as a password failure', { timeout: 60_000 }, async (t) => {
	const directory = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'archive-corrupt-'));
	const snapshot = fileURLToPath(new URL('../../../../fixtures/archives/corrupt-plain.zip', import.meta.url));
	const stage = join(directory, 'extracted');
	const result = await subject.extract(
		{ snapshot, stage, format: 'zip', excludedMembers: [], hasContent: true },
		() => 60_000,
		t.signal,
		() => undefined,
		'any-password',
	);
	assert.deepEqual(result, { outcome: { status: 'rejected', reason: 'rejected' }, done: false });
	await assert.rejects(stat(stage), { code: 'ENOENT' });
});
