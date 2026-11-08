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
