import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { LocalSuspendedTerminalLog } from './runtime/adapters/local-suspended-log.js';
import { TerminalCleanupFailure } from './runtime/terminal-errors.js';

const [directory, scenario] = process.argv.slice(2);
assert.ok(directory && ['append', 'replace', 'trim', 'replace-cleanup', 'trim-cleanup'].includes(scenario));
const kind = scenario.split('-')[0];
const cleanupFails = scenario.endsWith('-cleanup');
const mib = 1024 * 1024;
execFileSync('mount', ['-t', 'tmpfs', '-o', 'size=' + (kind === 'trim' ? '140m' : '8m'), 'nexus-b10-log', directory]);
const log = new LocalSuspendedTerminalLog(directory);
const id = 'enospc-history';
const path = join(directory, 'temp_backend_next_suspended_ssh_logs', id + '.log');
const remove = fs.rm;
let pinned;
try {
	const filesystem = await fs.statfs(directory);
	assert.equal(filesystem.type, 0x01021994, 'Writes are confined to the actual private tmpfs mount');
	assert.ok(filesystem.blocks * filesystem.bsize <= (kind === 'trim' ? 140 : 8) * mib);
	if (kind === 'trim') {
		for (let index = 0; index < 132; index += 1) {
			await log.append(id, Buffer.alloc(mib, index));
		}
	} else {
		await log.append(id, Buffer.from('confirmed original history'));
	}
	const original = await fs.readFile(path);
	pinned = await log.openRead(id);
	if (kind === 'append') {
		const filler = await fs.open(join(directory, 'filler'), 'w');
		try {
			while (true) {
				await filler.writeFile(Buffer.alloc(mib, 71));
			}
		} catch (error) {
			assert.equal(error.code, 'ENOSPC');
		} finally {
			await filler.close();
		}
	}
	const cleanup = new Error('controlled temporary removal refusal');
	let cleanupCalls = 0;
	if (cleanupFails) {
		fs.rm = async (target, options) => {
			if (String(target).includes('.' + kind + '-')) {
				cleanupCalls += 1;
				throw cleanup;
			}
			return remove(target, options);
		};
	}
	const failure = await log.append(id, Buffer.alloc(kind === 'replace' ? 100 * mib : mib, 211)).then(
		() => assert.fail('The actual finite filesystem must refuse the write'),
		(error) => error,
	);
	if (cleanupFails) {
		assert.ok(failure instanceof TerminalCleanupFailure);
		assert.ok(failure.cause instanceof AggregateError);
		assert.ok(failure.cause.errors.some((error) => error.code === 'ENOSPC'));
		assert.ok(failure.cause.errors.includes(cleanup));
		assert.equal(cleanupCalls, 1);
	} else {
		assert.equal(failure.code, 'ENOSPC');
	}
	await assert.rejects(log.flush(id), (error) => error === failure);
	await assert.rejects(log.append(id, Buffer.from('must not retry')), (error) => error === failure);
	const chunks = [];
	for await (const chunk of pinned) {
		chunks.push(chunk);
	}
	const bytes = Buffer.concat(chunks);
	const expected = original.subarray(Math.max(0, original.length - 100 * mib));
	assert.deepEqual(bytes, expected, 'Already opened history retains the confirmed original inode and bytes');
	const physical = await fs.readFile(path);
	if (kind === 'append') {
		assert.deepEqual(
			physical.subarray(0, original.length),
			original,
			'Partial append preserves the confirmed prefix',
		);
		assert.ok(physical.length < original.length + mib, 'ENOSPC is a partial write, not an atomic rollback');
		assert.deepEqual(physical.subarray(original.length), Buffer.alloc(physical.length - original.length, 211));
	} else {
		assert.deepEqual(physical, original, 'Failed publication never replaces the confirmed log');
	}
	const leftovers = (await fs.readdir(join(directory, 'temp_backend_next_suspended_ssh_logs'))).filter((name) =>
		name.includes('.' + kind + '-'),
	);
	assert.equal(leftovers.length, cleanupFails ? 1 : 0);
	const closing = log.close();
	assert.strictEqual(log.close(), closing);
	await assert.rejects(closing, (error) => error instanceof AggregateError && error.errors.includes(failure));
	process.stdout.write(
		JSON.stringify({
			scenario,
			code: 'ENOSPC',
			cleanupCalls,
			confirmedBytes: original.length,
			physicalBytes: physical.length,
			pinnedBytes: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			retainedTemporaryFiles: leftovers.length,
		}) + '\n',
	);
} finally {
	fs.rm = remove;
	pinned?.destroy();
	try {
		await log.close().catch(() => undefined);
	} finally {
		execFileSync('umount', [directory]);
	}
}
