import assert from 'node:assert/strict';
import { test } from 'vitest';
import { EventEmitter } from 'node:events';
import { MachineSftpFailure } from '../../../../../packages/backend/src/platform/ssh/ssh-port.ts';
import { SshSftpLease } from '../../../../../packages/backend/src/platform/ssh/adapters/ssh2/ssh-sftp.ts';

function sftpError(code, message) {
	return Object.assign(new Error(message), { code });
}

function callbackSftp(rename) {
	const value = new EventEmitter();
	value.rename = rename;
	value.end = () => queueMicrotask(() => value.emit('close'));
	value.destroy = () => queueMicrotask(() => value.emit('close'));
	return value;
}

test('SFTP outcome: pre-dispatch cancellation remains not_started', async (t) => {
	const sftp = callbackSftp(() => undefined);
	const lease = new SshSftpLease(sftp, () => undefined);
	t.onTestFinished(() => lease.close());
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		Promise.resolve().then(() => lease.rename('/a', '/b', { signal: controller.signal })),
		(error) => error instanceof MachineSftpFailure && error.outcome === 'not_started',
	);
	await lease.close();
});

test('SFTP outcome: a remote rejection remains a definite failure', async (t) => {
	const sftp = callbackSftp((_from, _to, callback) =>
		queueMicrotask(() => callback(sftpError(4, 'remote rejected'))),
	);
	const lease = new SshSftpLease(sftp, () => undefined);
	t.onTestFinished(() => lease.close());
	await assert.rejects(
		lease.rename('/a', '/b'),
		(error) => error instanceof MachineSftpFailure && error.outcome === 'failed',
	);
	await lease.close();
});

test('SFTP outcome: post-dispatch cancellation remains unknown', async (t) => {
	const sftp = callbackSftp(() => undefined);
	const lease = new SshSftpLease(sftp, () => undefined);
	t.onTestFinished(() => lease.close());
	const controller = new AbortController();
	const pending = lease.rename('/a', '/b', { signal: controller.signal, timeoutMs: 1000 });
	queueMicrotask(() => controller.abort());
	await assert.rejects(pending, (error) => error instanceof MachineSftpFailure && error.outcome === 'unknown');
});

test('SFTP listing honors caller budgets beyond the former adapter ceilings and still closes every handle', async (t) => {
	const attrs = {
		size: 0,
		uid: 0,
		gid: 0,
		mode: 0o100644,
		atime: 1,
		mtime: 1,

		isDirectory: () => false,

		isFile: () => true,

		isSymbolicLink: () => false,
	};
	const rows = Array.from({ length: 10001 }, (_, index) => ({
		filename: String(index),
		longname: 'metadata '.repeat(32) + index,
		attrs,
	}));
	const sftp = callbackSftp(() => undefined);
	let offset = 0;
	let closes = 0;
	sftp.opendir = (_path, callback) => {
		offset = 0;
		queueMicrotask(() => callback(null, Buffer.from('directory')));
	};
	sftp.readdir = (_handle, callback) => {
		const packet = rows.slice(offset, offset + 512);
		offset += packet.length;
		queueMicrotask(() => callback(packet.length ? null : sftpError(1, 'EOF'), packet));
	};
	sftp.close = (_handle, callback) => {
		closes++;
		queueMicrotask(() => callback(null));
	};
	const lease = new SshSftpLease(sftp, () => undefined);
	t.onTestFinished(() => lease.close());
	const budget = { maxEntries: rows.length, maxMetadataBytes: 8 * 1024 * 1024 };
	const result = await lease.list('/large', budget);
	assert.deepEqual(
		result.map((entry) => entry.name),
		rows.map((entry) => entry.filename),
	);
	assert.ok(Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024);
	assert.equal(closes, 1);
	for (const limited of [
		{ ...budget, maxEntries: rows.length - 1 },
		{ ...budget, maxMetadataBytes: 1024 },
	]) {
		await assert.rejects(
			lease.list('/large', limited),
			(error) => error instanceof MachineSftpFailure && error.reason === 'limit_exceeded',
		);
	}
	assert.equal(closes, 3);
});
