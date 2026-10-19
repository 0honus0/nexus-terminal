import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WorkspaceService } from '../../../packages/backend/dist/modules/remote/sessions/service/workspace-service.js';
import { SshShellChannel } from '../../../packages/backend/dist/platform/ssh/adapters/ssh2/ssh-channels.js';
import { WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES } from '../../../packages/shared/dist/remote/workspace/values.js';
import { openWorkspace, until } from './openssh-fixture.mjs';
import { remoteFilesFixture } from './file-transfer-fixture.mjs';

function success(response) {
	assert.equal(response.ok, true, JSON.stringify(response));
	return response.data;
}

function readPid(path) {
	return readFile(path, 'utf8').catch((error) => {
		if (error.code === 'ENOENT') {
			return '';
		}
		throw error;
	});
}

await test('Suspended ownership ACK cannot bypass outstanding terminal consumption', async (t) => {
	const f = await remoteFilesFixture(t);
	const original = await f.endpoint('suspended');
	const pidPath = join(original.root, 'shell.pid');
	success(await original.workspace.call('terminal.input', { data: `echo $$ > '${pidPath}'\n` }));
	const pid = Number(
		await until(
			() =>
				readFile(pidPath, 'utf8').catch((error) => {
					if (error.code === 'ENOENT') {
						return '';
					}
					throw error;
				}),
			Boolean,
			'Original shell identity',
		),
	);
	success(await original.workspace.call('terminal.resize', { columns: 500, rows: 300 }));
	const marked = success(
		await original.workspace.call('suspend.mark', { terminalSnapshot: ('B'.repeat(499) + '\r\n').repeat(299) }),
	);
	success(await original.workspace.call('suspend.prepare', {}));
	success(await original.workspace.call('suspend.commit', {}));
	await original.workspace.close();
	const resumed = await openWorkspace(f.address, f.cookie, { terminalAutoAck: false });
	t.after(() => resumed.close());
	const view = success(
		await resumed.call('suspend.resume', {
			suspendedSessionId: marked.suspendedSessionId,
			workspaceId: randomUUID(),
		}),
	);
	const baseline = Buffer.concat(resumed.terminal);
	assert.ok(
		baseline.length > 65536,
		'baseline is large enough to distinguish a reset from chunk-granular backpressure',
	);
	success(
		await resumed.call('suspend.resumeAck', {
			suspendedSessionId: marked.suspendedSessionId,
			resumeToken: view.resumeToken,
			attachmentGeneration: view.attachmentGeneration,
			ownershipGeneration: view.ownershipGeneration,
		}),
	);
	const output = join(original.root, 'payload');
	const payload = Buffer.alloc(2 * WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES, 75);
	await writeFile(output, payload);
	success(
		await resumed.call('terminal.input', {
			data: `printf '\\nB10_SUSPEND_START\\n'; cat '${output}'; printf '\\nB10_SUSPEND_END\\n'\n`,
		}),
	);
	await until(
		() => Buffer.concat(resumed.terminal).length,
		(size) => size >= WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES - 32768,
		'Resumed terminal reaches original consumption window',
	);
	await delay(200);
	const paused = Buffer.concat(resumed.terminal).length;
	assert.ok(
		paused <= WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES,
		'ownership ACK does not reset consumption counters or bypass the existing baseline bytes',
	);
	await delay(200);
	assert.equal(Buffer.concat(resumed.terminal).length, paused);
	assert.equal(Buffer.concat(resumed.terminal).includes(Buffer.from('\r\nB10_SUSPEND_END\r\n')), false);
	resumed.acknowledgeTerminal();
	const all = await until(
		() => Buffer.concat(resumed.terminal),
		(bytes) => bytes.includes(Buffer.from('\r\nB10_SUSPEND_END\r\n')),
		'Consumption ACK releases remaining actual PTY bytes',
	);
	const begin = Buffer.from('\r\nB10_SUSPEND_START\r\n');
	const end = Buffer.from('\r\nB10_SUSPEND_END\r\n');
	const start = all.indexOf(begin);
	assert.ok(start >= 0);
	const finish = all.indexOf(end, start + begin.length);
	assert.deepEqual(all.subarray(start + begin.length, finish), payload);
	const identity = join(original.root, 'resumed.pid');
	success(await resumed.call('terminal.input', { data: `echo $$ > '${identity}'\n` }));
	assert.equal(
		Number(
			await until(
				() =>
					readFile(identity, 'utf8').catch((error) => {
						if (error.code === 'ENOENT') {
							return '';
						}
						throw error;
					}),
				Boolean,
				'Resumed original shell identity',
			),
		),
		pid,
	);
	success(
		await resumed.call('workspace.close', {
			workspaceId: view.workspaceId,
			connectionId: view.connectionId,
			resumeToken: view.resumeToken,
			attachmentGeneration: view.attachmentGeneration,
		}),
	);
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
		'Explicit close terminates original suspended shell',
	);
});

await test('Natural prepare expiry releases only the prepared pause while consumer backpressure remains', async (t) => {
	const f = await remoteFilesFixture(t);
	const original = await f.endpoint('prepare-expiry');
	await original.workspace.close();
	let shell;
	const pause = SshShellChannel.prototype.pause;
	t.mock.method(SshShellChannel.prototype, 'pause', function () {
		shell = this;
		return pause.call(this);
	});
	const workspace = await openWorkspace(f.address, f.cookie, { terminalAutoAck: false });
	t.after(() => workspace.close());
	success(
		await workspace.call('workspace.connect', {
			workspaceId: randomUUID(),
			connectionId: original.target.id,
			viewport: { columns: 80, rows: 24 },
		}),
	);
	const pidPath = join(original.root, 'prepare.pid');
	success(await workspace.call('terminal.input', { data: `echo $$ > '${pidPath}'\n` }));
	const pid = Number(await until(() => readPid(pidPath), Boolean, 'Actual shell PID'));
	const payload = Buffer.alloc(2 * WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES, 80);
	const path = join(original.root, 'prepare.payload');
	await writeFile(path, payload);
	success(
		await workspace.call('terminal.input', {
			data: `printf '\\nB10_PREPARE_START\\n'; cat '${path}'; printf '\\nB10_PREPARE_END\\n'\n`,
		}),
	);
	await until(
		() =>
			shell?.readable.isPaused() &&
			Buffer.concat(workspace.terminal).length >= WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES - 32768,
		Boolean,
		'Original consumer window pauses the actual SSH readable',
	);
	const requestId = randomUUID();
	const response = new Promise((resolve) => {
		const listener = (bytes, binary) => {
			if (!binary) {
				const message = JSON.parse(bytes.toString());
				if (message.type === 'response' && message.requestId === requestId) {
					workspace.socket.off('message', listener);
					resolve(message.payload);
				}
			}
		};

		workspace.socket.on('message', listener);
		t.after(() => workspace.socket.off('message', listener));
	});
	const started = Date.now();
	workspace.socket.send(JSON.stringify({ type: 'suspend.prepare', requestId, payload: {} }));
	const failed = await response;
	assert.equal(failed.ok, false);
	assert.equal(failed.error, 'remote_unavailable');
	assert.ok(Date.now() - started >= 15000, 'The original 15-second product deadline elapsed');
	assert.equal(shell.readable.isPaused(), true, 'Prepare failure does not release the independent consumer pause');
	workspace.acknowledgeTerminal();
	const all = await until(
		() => Buffer.concat(workspace.terminal),
		(bytes) => bytes.includes(Buffer.from('\r\nB10_PREPARE_END\r\n')),
		'Consumer ACK resumes the original producer',
	);
	const begin = Buffer.from('\r\nB10_PREPARE_START\r\n');
	const start = all.indexOf(begin);
	assert.ok(start >= 0);
	const end = all.indexOf(Buffer.from('\r\nB10_PREPARE_END\r\n'), start + begin.length);
	assert.deepEqual(all.subarray(start + begin.length, end), payload);
	const nextPid = join(original.root, 'prepare-after.pid');
	success(await workspace.call('terminal.input', { data: `echo $$ > '${nextPid}'\n` }));
	assert.equal(Number(await until(() => readPid(nextPid), Boolean, 'Original PID after expiry')), pid);
	success(await workspace.call('suspend.prepare', {}));
	success(await workspace.call('suspend.commit', {}));
});

await test('Unmarking a prepared suspension cannot resume a consumer-paused SSH shell', async (t) => {
	const f = await remoteFilesFixture(t);
	const original = await f.endpoint('prepared-unmark');
	await original.workspace.close();
	const workspace = await openWorkspace(f.address, f.cookie, { terminalAutoAck: false });
	t.after(() => workspace.close());
	success(
		await workspace.call('workspace.connect', {
			workspaceId: randomUUID(),
			connectionId: original.target.id,
			viewport: { columns: 80, rows: 24 },
		}),
	);
	success(await workspace.call('suspend.mark', {}));
	let shell;
	const pause = SshShellChannel.prototype.pause;
	t.mock.method(SshShellChannel.prototype, 'pause', function () {
		shell = this;
		return pause.call(this);
	});
	let resumes = 0;
	const resume = SshShellChannel.prototype.resume;
	t.mock.method(SshShellChannel.prototype, 'resume', function () {
		if (this === shell) {
			resumes += 1;
		}
		return resume.call(this);
	});
	let prepared = false;
	const prepare = WorkspaceService.prototype.prepareSuspend;
	t.mock.method(WorkspaceService.prototype, 'prepareSuspend', async function (...args) {
		await prepare.apply(this, args);
		prepared = true;
	});
	const path = join(original.root, 'unmark.payload');
	const payload = Buffer.alloc(2 * WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES, 85);
	await writeFile(path, payload);
	success(
		await workspace.call('terminal.input', {
			data: `printf '\\nB10_UNMARK_START\\n'; cat '${path}'; printf '\\nB10_UNMARK_END\\n'\n`,
		}),
	);
	await until(
		() =>
			shell?.readable.isPaused() &&
			Buffer.concat(workspace.terminal).length >= WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES - 32768,
		Boolean,
		'Actual consumer window is paused',
	);
	const preparing = workspace.call('suspend.prepare', {});
	void preparing.catch(() => undefined);
	await until(() => prepared, Boolean, 'Actual suspension prepared while consumption remains blocked');
	const before = resumes;
	success(await workspace.call('suspend.unmark', {}));
	assert.equal(resumes, before, 'unmark releases only the prepared pause');
	assert.equal(shell.readable.isPaused(), true);
	workspace.acknowledgeTerminal();
	const all = await until(
		() => Buffer.concat(workspace.terminal),
		(bytes) => bytes.includes(Buffer.from('\r\nB10_UNMARK_END\r\n')),
		'Consumption resumes the original output after unmark',
	);
	await preparing;
	const begin = Buffer.from('\r\nB10_UNMARK_START\r\n');
	const start = all.indexOf(begin);
	assert.ok(start >= 0);
	const end = all.indexOf(Buffer.from('\r\nB10_UNMARK_END\r\n'), start + begin.length);
	assert.deepEqual(all.subarray(start + begin.length, end), payload);
});

await test('A prepared suspension detaches with no permanent PTY pause and preserves its actual background output', async (t) => {
	const f = await remoteFilesFixture(t);
	const owner = await f.endpoint('prepared-detach');
	const marked = success(await owner.workspace.call('suspend.mark', {}));
	const trigger = join(owner.root, 'detach.trigger');
	const done = join(owner.root, 'detach.done');
	success(
		await owner.workspace.call('terminal.input', {
			data: `while [ ! -f '${trigger}' ]; do sleep 0.05; done; printf '\\nB10_PREPARED_DETACH\\n'; echo $$ > '${done}'\n`,
		}),
	);
	success(await owner.workspace.call('suspend.prepare', {}));
	await owner.workspace.close();
	await writeFile(trigger, 'go');
	await until(() => readPid(done), Boolean, 'Original shell runs after its prepared attachment leaves');
	const path = join(f.directory, 'temp_backend_next_suspended_ssh_logs', marked.suspendedSessionId + '.log');
	const raw = await until(
		() => readFile(path),
		(bytes) => bytes.includes(Buffer.from('\r\nB10_PREPARED_DETACH\r\n')),
		'Detached raw log contains the original output',
	);
	assert.equal(raw.includes(Buffer.from('\r\nB10_PREPARED_DETACH\r\n')), true);
});
