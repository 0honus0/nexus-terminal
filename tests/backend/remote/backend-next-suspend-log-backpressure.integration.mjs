import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { SshShellChannel } from '../../../packages/backend/dist/platform/ssh/adapters/ssh2/ssh-channels.js';
import { openWorkspace, until } from './openssh-fixture.mjs';
import { remoteFilesFixture } from './file-transfer-fixture.mjs';

function success(response) {
	assert.equal(response.ok, true, JSON.stringify(response));
	return response.data;
}

await test('A real suspended PTY remains paused across detach while its log writer is backpressured', async (t) => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	t.after(() => release());
	const f = await remoteFilesFixture(t);
	let deliveredBytes = 0;
	const onStderr = SshShellChannel.prototype.onStderr;
	t.mock.method(SshShellChannel.prototype, 'onStderr', function (listener) {
		const count = (bytes) => {
			deliveredBytes += bytes.length;
		};

		this.readable.on('data', count);
		t.after(() => this.readable.off('data', count));
		return onStderr.call(this, listener);
	});
	const owner = await f.endpoint('slow-log');
	const marked = success(await owner.workspace.call('suspend.mark', {}));
	deliveredBytes = 0;
	const append = fs.appendFile;
	let writing = false;
	let resumes = 0;
	let pausedShell;
	const pause = SshShellChannel.prototype.pause;
	const resume = SshShellChannel.prototype.resume;
	t.mock.method(SshShellChannel.prototype, 'pause', function () {
		pausedShell = this;
		return pause.call(this);
	});
	t.mock.method(SshShellChannel.prototype, 'resume', function () {
		resumes += 1;
		return resume.call(this);
	});
	t.mock.method(fs, 'appendFile', async (path, bytes, options) => {
		if (String(path).endsWith(marked.suspendedSessionId + '.log')) {
			writing = true;
			await gate;
		}
		return append(path, bytes, options);
	});
	const done = join(owner.root, 'producer.done');
	success(
		await owner.workspace.call('terminal.input', {
			data: `printf '\\nB10_DISK_BEGIN\\n'; head -c 16777216 /dev/zero | tr '\\000' 'R'; printf '\\n%s%s\\n' 'B10_DISK_' 'END'; echo done > '${done}'\n`,
		}),
	);
	await until(
		() => writing && deliveredBytes > 2 * 1024 * 1024 && pausedShell?.readable.isPaused(),
		Boolean,
		'Actual log write waits with more than 2 MiB delivered into the log backlog',
	);
	const beforeDetach = resumes;
	await owner.workspace.close();
	await delay(200);
	assert.equal(pausedShell.readable.isPaused(), true, 'detach must not override the log backlog pause');
	assert.equal(resumes, beforeDetach, 'no owner forces a resume while the real disk write is pending');
	release();
	await until(
		() =>
			fs.readFile(done, 'utf8').catch((error) => {
				if (error.code === 'ENOENT') {
					return '';
				}
				throw error;
			}),
		Boolean,
		'Actual remote producer completes after disk backpressure is released',
	);
	const logPath = join(f.directory, 'temp_backend_next_suspended_ssh_logs', marked.suspendedSessionId + '.log');
	const bytes = await until(
		() => fs.readFile(logPath),
		(value) => value.includes(Buffer.from('\r\nB10_DISK_END\r\n')),
		'Complete raw terminal history reaches the real log',
	);
	const begin = Buffer.from('\r\nB10_DISK_BEGIN\r\n');
	const start = bytes.indexOf(begin);
	const end = bytes.indexOf(Buffer.from('\r\nB10_DISK_END\r\n'), start + begin.length);
	assert.ok(start >= 0);
	assert.deepEqual(bytes.subarray(start + begin.length, end), Buffer.alloc(16 * 1024 * 1024, 82));
	assert.ok(resumes > beforeDetach, 'the original owner resumes only after backlog drains');
});

await test('An actual suspended-log append refusal closes its original PTY and preserves its cause through shutdown', async (t) => {
	const f = await remoteFilesFixture(t);
	const owner = await f.endpoint('log-append-refusal');
	const pidPath = join(owner.root, 'refused.pid');
	success(await owner.workspace.call('terminal.input', { data: `echo $$ > '${pidPath}'\n` }));
	const pid = Number(
		await until(
			() =>
				fs.readFile(pidPath, 'utf8').catch((error) => {
					if (error.code === 'ENOENT') {
						return '';
					}
					throw error;
				}),
			Boolean,
			'Actual PTY before log refusal',
		),
	);
	const marked = success(
		await owner.workspace.call('suspend.mark', { terminalSnapshot: 'B10 confirmed before refusal\r\n' }),
	);
	const path = join(f.directory, 'temp_backend_next_suspended_ssh_logs', marked.suspendedSessionId + '.log');
	// Pin a confirmed original log, then cause a real kernel EISDIR at the append path.
	await until(
		() =>
			fs.stat(path).catch((error) => {
				if (error.code === 'ENOENT') {
					return null;
				}
				throw error;
			}),
		Boolean,
		'Actual log created',
	);
	const original = path + '.original';
	await fs.rename(path, original);
	await fs.mkdir(path);
	success(await owner.workspace.call('terminal.input', { data: "printf '\\nB10_LOG_REFUSED\\n'\n" }));
	await until(
		() => {
			try {
				process.kill(pid, 0);
				return false;
			} catch (error) {
				if (error.code === 'ESRCH') {
					return true;
				}
				throw error;
			}
		},
		Boolean,
		'Failed recording closes the actual original shell',
	);
	assert.equal((await fs.stat(path)).isDirectory(), true, 'the failed path is not silently replaced');
	const app = f.state.app;
	const closing = app.close();
	// Observe the failure even if another assertion fails before awaiting it below.
	void closing.catch(() => undefined);
	f.state.app = null;
	const failure = await closing.then(
		() => assert.fail('Failed log cleanup must remain in shutdown'),
		(error) => error,
	);
	const pending = [failure];
	const seen = new Set();
	for (const error of pending) {
		if (seen.has(error)) {
			continue;
		}
		seen.add(error);
		if (error instanceof AggregateError) {
			pending.push(...error.errors);
		}
		if (error instanceof Error && error.cause) {
			pending.push(error.cause);
		}
	}
	assert.ok(
		[...seen].some((error) => error instanceof Error && error.code === 'EISDIR'),
		'actual filesystem cause survives Model and owner cleanup',
	);
	assert.ok((await fs.stat(original)).isFile(), 'confirmed prior history remains available for independent recovery');
});

await test('Taking over an unconfirmed suspended resume cannot bypass the real slow-log pause during rollback', async (t) => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	t.after(() => release());
	const f = await remoteFilesFixture(t);
	let delivered = 0;
	const stderr = SshShellChannel.prototype.onStderr;
	t.mock.method(SshShellChannel.prototype, 'onStderr', function (listener) {
		const count = (bytes) => {
			delivered += bytes.length;
		};

		this.readable.on('data', count);
		t.after(() => this.readable.off('data', count));
		return stderr.call(this, listener);
	});
	const owner = await f.endpoint('slow-log-rollback');
	const mark = success(await owner.workspace.call('suspend.mark', {}));
	delivered = 0;
	const append = fs.appendFile;
	let writing = false;
	t.mock.method(fs, 'appendFile', async (path, bytes, options) => {
		if (String(path).endsWith(mark.suspendedSessionId + '.log')) {
			writing = true;
			await gate;
		}
		return append(path, bytes, options);
	});
	let pausedShell;
	let pauses = 0;
	let resumes = 0;
	const pause = SshShellChannel.prototype.pause;
	const resume = SshShellChannel.prototype.resume;
	t.mock.method(SshShellChannel.prototype, 'pause', function () {
		pausedShell = this;
		pauses += 1;
		return pause.call(this);
	});
	t.mock.method(SshShellChannel.prototype, 'resume', function () {
		if (this === pausedShell) {
			resumes += 1;
		}
		return resume.call(this);
	});
	const done = join(owner.root, 'rollback.done');
	success(
		await owner.workspace.call('terminal.input', {
			data: `printf '\\nB10_ROLLBACK_BEGIN\\n'; head -c 16777216 /dev/zero | tr '\\000' 'K'; printf '\\nB10_ROLLBACK_END\\n'; echo done > '${done}'\n`,
		}),
	);
	await until(
		() => writing && delivered > 2 * 1024 * 1024 && pausedShell?.readable.isPaused(),
		Boolean,
		'Actual SSH bytes exceed 2MiB while the original disk append waits',
	);
	await owner.workspace.close();
	const first = await openWorkspace(f.address, f.cookie);
	const next = await openWorkspace(f.address, f.cookie);
	t.after(() => first.close());
	t.after(() => next.close());
	const before = pauses;
	const pending = first.call('suspend.resume', {
		suspendedSessionId: mark.suspendedSessionId,
		workspaceId: randomUUID(),
	});
	void pending.catch(() => undefined);
	await until(
		() => pauses,
		(value) => value > before,
		'First actual pending resume paused its original PTY before awaiting log tail',
	);
	const resumeBefore = resumes;
	const pauseBefore = pauses;
	const takeover = next.call('suspend.resume', {
		suspendedSessionId: mark.suspendedSessionId,
		workspaceId: randomUUID(),
		takeover: true,
	});
	void takeover.catch(() => undefined);
	await until(
		() => pauses,
		(value) => value > pauseBefore,
		'Takeover rolled back the old reservation and paused the replacement',
	);
	assert.equal(resumes, resumeBefore, 'rollback does not resume a shell whose original log queue remains blocked');
	assert.equal(pausedShell.readable.isPaused(), true);
	release();
	assert.equal((await pending).ok, false, 'superseded preparation cannot publish its old lease');
	const lease = success(await takeover);
	success(
		await next.call('suspend.resumeAck', {
			suspendedSessionId: mark.suspendedSessionId,
			resumeToken: lease.resumeToken,
			attachmentGeneration: lease.attachmentGeneration,
			ownershipGeneration: lease.ownershipGeneration,
		}),
	);
	await until(
		() =>
			fs.readFile(done, 'utf8').catch((error) => {
				if (error.code === 'ENOENT') {
					return '';
				}
				throw error;
			}),
		Boolean,
		'The original actual producer finishes after the log queue drains',
	);
	const path = join(f.directory, 'temp_backend_next_suspended_ssh_logs', mark.suspendedSessionId + '.log');
	const all = await until(
		() => fs.readFile(path),
		(bytes) => bytes.includes(Buffer.from('\r\nB10_ROLLBACK_END\r\n')),
		'Original history finishes without dropped output',
	);
	const begin = Buffer.from('\r\nB10_ROLLBACK_BEGIN\r\n');
	const start = all.indexOf(begin);
	assert.ok(start >= 0);
	const end = all.indexOf(Buffer.from('\r\nB10_ROLLBACK_END\r\n'), start + begin.length);
	assert.deepEqual(all.subarray(start + begin.length, end), Buffer.alloc(16 * 1024 * 1024, 75));
});
