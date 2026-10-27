import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES } from '../../../packages/shared/dist/remote/workspace/values.js';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';
import { origin, until, send, expectStatus, openSshd, openWorkspace } from './openssh-fixture.mjs';

function success(response) {
	assert.equal(response.ok, true, JSON.stringify(response));
	return response.data;
}

function resumeRequest(view) {
	return {
		workspaceId: view.workspaceId,
		connectionId: view.connectionId,
		resumeToken: view.resumeToken,
		attachmentGeneration: view.attachmentGeneration,
		terminalOffset: 0,
	};
}

function closeRequest(view) {
	return {
		workspaceId: view.workspaceId,
		connectionId: view.connectionId,
		resumeToken: view.resumeToken,
		attachmentGeneration: view.attachmentGeneration,
	};
}

function ack(view) {
	return { resumeToken: view.resumeToken, attachmentGeneration: view.attachmentGeneration };
}

function assertTerminalPayload(output, name, byte, size) {
	const begin = Buffer.from('B10_' + name + '_BEGIN\r\n');
	const end = Buffer.from('\r\nB10_' + name + '_END');
	const start = output.indexOf(begin);
	assert.ok(start >= 0, 'payload begin marker');
	const finish = output.indexOf(end, start + begin.length);
	assert.ok(finish >= 0, 'payload end marker');
	const payload = output.subarray(start + begin.length, finish);
	assert.equal(payload.length, size);
	assert.equal(Buffer.compare(payload, Buffer.alloc(size, byte)), 0, 'exact payload bytes and order');
	assert.equal(output.indexOf(begin, start + 1), -1, 'begin marker occurs once');
	assert.equal(output.indexOf(end, finish + 1), -1, 'end marker occurs once');
}

async function readIfPresent(path) {
	try {
		return await readFile(path, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

await test('B10 real Workspace resume ACK, suspend ownership and Access revocation', { timeout: 60000 }, async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-resume-'));
	const sockets = [];
	let sshd;
	let app;
	let address;
	let cookie = '';
	let target;

	const api = (method, path, input) => send(address, cookie, method, path, input);

	const open = async (options) => {
		const workspace = await openWorkspace(address, cookie, options);
		sockets.push(workspace);
		return workspace;
	};

	const connect = async (workspace) =>
		success(
			await workspace.call('workspace.connect', {
				workspaceId: randomUUID(),
				connectionId: target.id,
				viewport: { columns: 100, rows: 30 },
			}),
		);

	const input = async (workspace, data) => success(await workspace.call('terminal.input', { data }));

	const filesReady = (workspace) =>
		until(
			() => workspace.events.find((event) => ['filesystem.ready', 'filesystem.error'].includes(event.type)),
			(event) => {
				if (event?.type === 'filesystem.error') {
					assert.fail(JSON.stringify(event));
				}
				return event?.type === 'filesystem.ready';
			},
			'SFTP ready after ownership commit',
		);

	const startShell = async (workspace, name) => {
		const path = join(directory, name + '.pid');
		await input(workspace, `echo $$ > '${path}'\n`);
		return Number(
			await until(
				() => readIfPresent(path),
				(value) => value !== null,
				'real shell PID',
			),
		);
	};

	const shellAlive = (pid) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch (error) {
			if (error.code === 'ESRCH') {
				return false;
			}
			throw error;
		}
	};

	try {
		sshd = await openSshd(directory);
		app = await createApp(join(directory, 'state.db'), { encryptionKey: randomBytes(32) });
		address = await app.listenHttp({ publicOrigin: origin, bindHost: '127.0.0.1', port: 0, trustedProxies: [] });
		const password = 'b10-resume-password';
		expectStatus(
			await api('POST', '/api/v1/auth/setup', { username: 'admin', password, confirmPassword: password }),
			201,
		);
		const login = await api('POST', '/api/v1/auth/login', { username: 'admin', password, rememberMe: false });
		expectStatus(login, 200);
		cookie = login.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
		await app.targets.hostKeys.confirm({ host: '127.0.0.1', port: sshd.port, fingerprint: sshd.fingerprint });
		const key = await app.targets.sshKeys.create({ name: 'B10 resume key', privateKey: sshd.privateKey });
		target = await app.targets.create({
			name: 'B10 resume',
			type: 'SSH',
			host: '127.0.0.1',
			port: sshd.port,
			username: sshd.user,
			route: 'direct',
			proxyId: null,
			tagIds: [],
			jumpIds: [],
			notes: null,
		});
		assert.equal(
			(await app.targets.credentials.set(target.id, target.version, { kind: 'ssh_key', sshKeyId: key.id }))
				.status,
			'updated',
		);

		await t.test(
			'ordinary disconnect preserves shell, rejects premature/wrong ACK and rotates credentials',
			async () => {
				const first = await open();
				const initial = await connect(first);
				await filesReady(first);
				const pid = await startShell(first, 'ordinary');
				const marker = join(directory, 'detached-output');
				const trigger = join(directory, 'emit-output');
				await input(
					first,
					`(while [ ! -e '${trigger}' ]; do sleep 0.02; done; printf '\\n%s%s\\n' 'B10_' 'DETACHED_OUTPUT'; echo done > '${marker}') &\n`,
				);
				await first.close();
				await writeFile(trigger, 'emit');
				await until(() => readIfPresent(marker), Boolean, 'background output while socket is detached');
				assert.equal(shellAlive(pid), true);
				const replacement = await open();
				const resumed = success(await replacement.call('workspace.resume', resumeRequest(initial)));
				assert.equal(resumed.attachmentGeneration, initial.attachmentGeneration + 1);
				assert.notEqual(resumed.resumeToken, initial.resumeToken);
				assert.equal(Buffer.concat(replacement.terminal).length, resumed.replayedBytes);
				assert.equal(Buffer.concat(replacement.terminal).toString().split('B10_DETACHED_OUTPUT').length - 1, 1);
				assert.equal((await replacement.call('terminal.input', { data: 'echo forbidden\n' })).ok, false);
				assert.equal((await replacement.call('workspace.resumeAck', ack(initial))).ok, false);
				success(await replacement.call('workspace.resumeAck', ack(resumed)));
				await filesReady(replacement);
				const confirm = join(directory, 'same-shell');
				await input(replacement, `echo $$ > '${confirm}'\n`);
				assert.equal(Number(await until(() => readIfPresent(confirm), Boolean, 'same shell after ACK')), pid);
				assert.equal((await replacement.call('workspace.close', closeRequest(initial))).ok, false);
				assert.equal(shellAlive(pid), true);
				await replacement.close();
				const stale = await open();
				assert.equal((await stale.call('workspace.resume', resumeRequest(initial))).ok, false);
				await stale.close();
				const final = await open();
				const latest = success(await final.call('workspace.resume', resumeRequest(resumed)));
				success(await final.call('workspace.resumeAck', ack(latest)));
				success(await final.call('workspace.close', closeRequest(latest)));
				await until(
					() => shellAlive(pid),
					(alive) => !alive,
					'explicit close stops actual shell',
				);
			},
		);

		await t.test(
			'suspend prepare/commit, abandoned ACK rollback, lease renewal and takeover retain original shell',
			async () => {
				const first = await open();
				await connect(first);
				await filesReady(first);
				const pid = await startShell(first, 'suspend');
				const marked = success(await first.call('suspend.mark', {}));
				success(await first.call('suspend.prepare', {}));
				assert.equal(
					success(await first.call('suspend.commit', {})).suspendedSessionId,
					marked.suspendedSessionId,
				);
				await first.close();
				assert.equal(shellAlive(pid), true);
				const abandoned = await open();
				const pending = success(
					await abandoned.call('suspend.resume', {
						suspendedSessionId: marked.suspendedSessionId,
						workspaceId: randomUUID(),
					}),
				);
				assert.equal((await abandoned.call('terminal.input', { data: 'echo forbidden\n' })).ok, false);
				assert.equal(
					(
						await abandoned.call('suspend.resumeAck', {
							suspendedSessionId: marked.suspendedSessionId,
							...ack(pending),
							ownershipGeneration: pending.ownershipGeneration + 1,
						})
					).ok,
					false,
				);
				await abandoned.close();
				const owner = await open();
				const resumed = success(
					await owner.call('suspend.resume', {
						suspendedSessionId: marked.suspendedSessionId,
						workspaceId: randomUUID(),
					}),
				);
				success(
					await owner.call('suspend.resumeAck', {
						suspendedSessionId: marked.suspendedSessionId,
						...ack(resumed),
						ownershipGeneration: resumed.ownershipGeneration,
					}),
				);
				await filesReady(owner);
				const renewed = success(await owner.call('suspend.owner.renew', {}));
				assert.equal(renewed.generation, resumed.ownershipGeneration);
				assert.ok(renewed.leaseExpiresAt > Date.now());
				const successor = await open();
				assert.equal(
					(
						await successor.call('suspend.resume', {
							suspendedSessionId: marked.suspendedSessionId,
							workspaceId: randomUUID(),
						})
					).ok,
					false,
				);
				const taken = success(
					await successor.call('suspend.resume', {
						suspendedSessionId: marked.suspendedSessionId,
						workspaceId: randomUUID(),
						takeover: true,
					}),
				);
				success(
					await successor.call('suspend.resumeAck', {
						suspendedSessionId: marked.suspendedSessionId,
						...ack(taken),
						ownershipGeneration: taken.ownershipGeneration,
					}),
				);
				assert.equal(taken.ownershipGeneration, resumed.ownershipGeneration + 1);
				assert.equal((await owner.closed)[0], 1008);
				assert.ok(
					owner.events.some(
						(event) => event.type === 'suspend.revoked' && event.payload.reason === 'takeover',
					),
				);
				const path = join(directory, 'takeover.pid');
				await input(successor, `echo $$ > '${path}'\n`);
				assert.equal(Number(await until(() => readIfPresent(path), Boolean, 'takeover keeps shell')), pid);
				success(await successor.call('workspace.close', closeRequest(taken)));
				await until(
					() => shellAlive(pid),
					(alive) => !alive,
					'suspended shell terminated by explicit close',
				);
			},
		);

		await t.test('real PTY stops at the unacknowledged window and resumes without losing output', async () => {
			const workspace = await open({ terminalAutoAck: false });
			const view = await connect(workspace);
			await filesReady(workspace);
			const pid = await startShell(workspace, 'backpressure');
			const ready = join(directory, 'backpressure.ready');
			await input(workspace, `stty -echo; echo ready > '${ready}'\n`);
			await until(() => readIfPresent(ready), Boolean, 'disable PTY command echo');

			const bytes = () => workspace.terminal.reduce((total, chunk) => total + chunk.length, 0);

			const done = join(directory, 'backpressure.done');
			await input(
				workspace,
				`printf '\\nB10_FLOW_BEGIN\\n'; head -c 6291456 /dev/zero | tr '\\000' 'Q'; printf '\\n%s%s\\n' 'B10_' 'FLOW_END'; echo done > '${done}'\n`,
			);
			await until(
				bytes,
				(value) => value >= WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES - 65536,
				'real PTY fills the consumer window',
			);
			await delay(200);
			const paused = bytes();
			assert.ok(paused <= WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES);
			await delay(200);
			assert.equal(bytes(), paused, 'no unacknowledged output escapes the window');
			assert.equal(
				(await workspace.call('terminal.flow', { consumedBytes: paused + 1 })).ok,
				false,
				'ACK cannot claim bytes not delivered',
			);
			success(await workspace.call('terminal.flow', { consumedBytes: paused }));
			await until(bytes, (value) => value > paused, 'valid ACK releases the actual stream');
			assert.equal((await workspace.call('terminal.flow', { consumedBytes: 0 })).ok, false);
			workspace.acknowledgeTerminal();
			await until(
				() => ({
					bytes: bytes(),
					complete: Buffer.concat(workspace.terminal).includes(Buffer.from('B10_FLOW_END')),
					errors: workspace.events.filter((event) => event.type === 'protocol.error').slice(-5),
				}),
				(value) => value.complete,
				'complete output after consumer resumes',
			);
			await until(() => readIfPresent(done), Boolean, 'producer completes');
			const output = Buffer.concat(workspace.terminal);
			assertTerminalPayload(output, 'FLOW', 81, 6291456);
			const confirm = join(directory, 'backpressure-same.pid');
			await input(workspace, `echo $$ > '${confirm}'\n`);
			assert.equal(Number(await until(() => readIfPresent(confirm), Boolean, 'original shell after flow')), pid);
			assert.equal(Number((await workspace.read(confirm, 1024)).toString('utf8')), pid);
			success(await workspace.call('workspace.close', closeRequest(view)));
			await until(
				() => shellAlive(pid),
				(alive) => !alive,
				'backpressured shell closes',
			);
		});

		await t.test(
			'disconnect releases consumer pause; replay waits for actual byte ACK before ownership ACK',
			async () => {
				const first = await open({ terminalAutoAck: false });
				const initial = await connect(first);
				await filesReady(first);
				const pid = await startShell(first, 'paused-detach');
				const ready = join(directory, 'paused-detach.ready');
				const done = join(directory, 'paused-detach.done');
				await input(first, `stty -echo; echo ready > '${ready}'\n`);
				await until(() => readIfPresent(ready), Boolean, 'disable echo before detached producer');
				await input(
					first,
					`printf '\\nB10_DETACH_FLOW_BEGIN\\n'; head -c 4194304 /dev/zero | tr '\\000' 'R'; printf '\\n%s%s\\n' 'B10_' 'DETACH_FLOW_END'; echo done > '${done}'\n`,
				);
				await until(
					() => Buffer.concat(first.terminal).length,
					(value) => value >= WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES - 65536,
					'first attachment stops consuming',
				);
				await first.close();
				const delivered = Buffer.concat(first.terminal);
				await until(() => readIfPresent(done), Boolean, 'detach resumes actual paused producer');
				const replacement = await open({ terminalAutoAck: false });
				let settled = false;
				const pending = replacement.call('workspace.resume', {
					...resumeRequest(initial),
					terminalOffset: delivered.length,
				});
				void pending.then(
					() => {
						settled = true;
					},
					() => {
						settled = true;
					},
				);
				await until(
					() => Buffer.concat(replacement.terminal).length,
					(value) => value >= WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES - 65536,
					'replay reaches the independent replacement consumer window',
				);
				await delay(200);
				assert.equal(settled, false, 'resume does not complete before replay is delivered');
				assert.ok(Buffer.concat(replacement.terminal).length <= WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES);
				assert.equal((await replacement.call('terminal.input', { data: 'echo forbidden\n' })).ok, false);
				replacement.acknowledgeTerminal();
				const resumed = success(await pending);
				assert.equal(Buffer.concat(replacement.terminal).length, resumed.replayedBytes);
				const all = Buffer.concat([delivered, ...replacement.terminal]);
				assertTerminalPayload(all, 'DETACH_FLOW', 82, 4194304);
				assert.equal((await replacement.call('terminal.input', { data: 'echo forbidden\n' })).ok, false);
				success(await replacement.call('workspace.resumeAck', ack(resumed)));
				await filesReady(replacement);
				const confirm = join(directory, 'paused-detach-same.pid');
				await input(replacement, `echo $$ > '${confirm}'\n`);
				assert.equal(
					Number(await until(() => readIfPresent(confirm), Boolean, 'paused detach keeps original PID')),
					pid,
				);
				success(await replacement.call('workspace.close', closeRequest(resumed)));
				await until(
					() => shellAlive(pid),
					(alive) => !alive,
					'detached producer shell closes',
				);
			},
		);

		await t.test('journal trimming rejects old/future offsets without consuming resume credentials', async () => {
			const first = await open();
			const initial = await connect(first);
			await filesReady(first);
			const pid = await startShell(first, 'journal');
			const trigger = join(directory, 'journal.trigger');
			const done = join(directory, 'journal.done');
			await input(
				first,
				`(while [ ! -e '${trigger}' ]; do sleep 0.02; done; head -c 10485760 /dev/zero | tr '\\000' 'J'; printf '\\n%s%s\\n' 'B10_' 'JOURNAL_END'; echo done > '${done}') &\n`,
			);
			await first.close();
			await writeFile(trigger, 'emit');
			await until(() => readIfPresent(done), Boolean, 'detached producer emits more than retained journal');
			const replacement = await open();
			assert.equal((await replacement.call('workspace.resume', resumeRequest(initial))).ok, false);
			assert.equal(
				(
					await replacement.call('workspace.resume', {
						...resumeRequest(initial),
						terminalOffset: Number.MAX_SAFE_INTEGER,
					})
				).ok,
				false,
			);
			assert.equal(replacement.terminal.length, 0, 'rejected offsets do not publish a partial replay');
			const resumed = success(
				await replacement.call('workspace.resume', {
					...resumeRequest(initial),
					terminalOffset: 3 * 1024 * 1024,
				}),
			);
			const replay = Buffer.concat(replacement.terminal);
			assert.equal(replay.length, resumed.replayedBytes);
			assert.equal(resumed.replayedBytes, resumed.terminalOffset - 3 * 1024 * 1024);
			assert.ok(replay.length > 6 * 1024 * 1024 && replay.length <= 8 * 1024 * 1024);
			assert.equal(replay.toString('utf8').split('B10_JOURNAL_END').length - 1, 1);
			assert.equal(resumed.attachmentGeneration, initial.attachmentGeneration + 1);
			success(await replacement.call('workspace.resumeAck', ack(resumed)));
			await filesReady(replacement);
			const confirm = join(directory, 'journal-same.pid');
			await input(replacement, `echo $$ > '${confirm}'\n`);
			assert.equal(
				Number(await until(() => readIfPresent(confirm), Boolean, 'original shell after large replay')),
				pid,
			);
			success(await replacement.call('workspace.close', closeRequest(resumed)));
			await until(
				() => shellAlive(pid),
				(alive) => !alive,
				'journal shell closes',
			);
		});

		await t.test(
			'logout rejects the old cookie; a fresh login resumes the retained shell and refreshes Files',
			async () => {
				const workspace = await open();
				const view = await connect(workspace);
				await filesReady(workspace);
				const pid = await startShell(workspace, 'revoked');
				expectStatus(await api('POST', '/api/v1/auth/logout', {}), 200);
				assert.equal((await workspace.closed)[0], 1008);
				assert.equal(shellAlive(pid), true);
				assert.equal((await api('GET', '/api/v1/auth/status')).status, 401);
				await assert.rejects(openWorkspace(address, cookie));
				const relogin = await api('POST', '/api/v1/auth/login', {
					username: 'admin',
					password,
					rememberMe: false,
				});
				expectStatus(relogin, 200);
				const oldCookie = cookie;
				cookie = relogin.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
				assert.notEqual(cookie, oldCookie);
				const replacement = await open();
				const resumed = success(await replacement.call('workspace.resume', resumeRequest(view)));
				success(await replacement.call('workspace.resumeAck', ack(resumed)));
				await filesReady(replacement);
				const path = join(directory, 'relogin.pid');
				await input(replacement, `echo $$ > '${path}'\n`);
				assert.equal(Number(await until(() => readIfPresent(path), Boolean, 'relogin keeps shell')), pid);
				assert.equal(Number((await replacement.read(path, 1024)).toString('utf8')), pid);
				success(await replacement.call('workspace.close', closeRequest(resumed)));
				await until(
					() => shellAlive(pid),
					(alive) => !alive,
					'explicit close after relogin stops shell',
				);
			},
		);
	} finally {
		const outcomes = await Promise.allSettled(sockets.map((workspace) => workspace.close()));
		for (const close of [
			() => app?.close(),
			() => sshd?.close(),
			() => rm(directory, { recursive: true, force: true }),
		]) {
			try {
				await close();
			} catch (reason) {
				outcomes.push({ status: 'rejected', reason });
			}
		}
		const failures = outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason);
		if (failures.length) {
			throw new AggregateError(failures, 'Workspace fixture cleanup failed');
		}
	}
});
