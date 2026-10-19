import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, readdir, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from '../../../packages/backend/node_modules/ws/index.js';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';
import { RemoteResourceCleanupFailure } from '../../../packages/backend/dist/modules/remote/resource-errors.js';
import { RemoteFileFailure } from '../../../packages/backend/dist/modules/remote/files/model/file-types.js';
import { origin, until, send, expectStatus, openSshd, openWorkspace } from './openssh-fixture.mjs';

async function openFileHandles(path) {
	const holders = [];
	for (const pid of (await readdir('/proc')).filter((name) => /^\d+$/u.test(name))) {
		try {
			for (const fd of await readdir(`/proc/${pid}/fd`)) {
				try {
					if ((await readlink(`/proc/${pid}/fd/${fd}`)) === path) {
						holders.push({ pid: Number(pid), fd });
					}
				} catch (error) {
					if (!['ENOENT', 'EACCES'].includes(error.code)) {
						throw error;
					}
				}
			}
		} catch (error) {
			if (!['ENOENT', 'EACCES'].includes(error.code)) {
				throw error;
			}
		}
	}
	return holders;
}

function hasCleanupFailure(error) {
	return (
		error instanceof RemoteResourceCleanupFailure ||
		(error instanceof AggregateError && error.errors.some(hasCleanupFailure)) ||
		(error instanceof Error && error.cause !== undefined && hasCleanupFailure(error.cause))
	);
}

function hasOnlyExpectedShutdownFailures(error) {
	if (error instanceof AggregateError) {
		return error.errors.length > 0 && error.errors.every(hasOnlyExpectedShutdownFailures);
	}
	return error instanceof RemoteFileFailure && ['operation_unknown', 'remote_unavailable'].includes(error.code);
}

await test(
	'B10 real OpenSSH upload cancellation, transport loss and Workspace close',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-upload-'));
		const workspaces = [];
		const streams = [];
		const daemons = [];
		let app;
		let address;
		let cookie = '';
		let expectedShutdownFailure = false;
		const original = Buffer.from('original destination must survive');
		const chunk = randomBytes(128 * 1024);
		const size = chunk.length * 2;

		const api = (method, path, input) => send(address, cookie, method, path, input);

		async function connectWorkspace(targetId) {
			const workspace = await openWorkspace(address, cookie);
			workspaces.push(workspace);
			const response = await workspace.call('workspace.connect', {
				workspaceId: randomUUID(),
				connectionId: targetId,
				viewport: { columns: 80, rows: 24 },
			});
			assert.equal(response.ok, true, JSON.stringify(response));
			const ready = await until(
				() => workspace.events.find((event) => ['filesystem.ready', 'filesystem.error'].includes(event.type)),
				Boolean,
				'Workspace filesystem readiness',
			);
			assert.equal(ready.type, 'filesystem.ready', JSON.stringify(ready));
			return { workspace, connection: response.data, targetId };
		}

		function uploadEvent(workspace, uploadId, types) {
			return until(
				() =>
					workspace.events.find(
						(event) =>
							event.type === 'transfer.upload' &&
							event.payload.uploadId === uploadId &&
							types.includes(event.payload.type),
					),
				Boolean,
				'Upload event ' + types.join('/'),
			);
		}

		async function connectStream(connection, uploadId, bytes = size) {
			const query = new URLSearchParams({ workspaceId: connection.workspaceId, uploadId, size: String(bytes) });
			const socket = new WebSocket('ws://' + address + '/ws/uploads?' + query, {
				origin,
				headers: { Host: new URL(origin).host, Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' },
			});
			streams.push(socket);
			const closed = new Promise((resolve) => socket.once('close', (...args) => resolve(args)));
			await once(socket, 'open');
			return { socket, closed };
		}

		async function closeWorkspace({ workspace, connection, targetId }) {
			return workspace.call('workspace.close', {
				workspaceId: connection.workspaceId,
				connectionId: targetId,
				resumeToken: connection.resumeToken,
				attachmentGeneration: connection.attachmentGeneration,
			});
		}

		async function installTarget(root, name) {
			const daemon = await openSshd(root);
			daemons.push(daemon);
			await app.targets.hostKeys.confirm({
				host: '127.0.0.1',
				port: daemon.port,
				fingerprint: daemon.fingerprint,
			});
			const key = await app.targets.sshKeys.create({ name: name + ' key', privateKey: daemon.privateKey });
			const target = await app.targets.create({
				name,
				type: 'SSH',
				host: '127.0.0.1',
				port: daemon.port,
				username: daemon.user,
				route: 'direct',
				proxyId: null,
				tagIds: [],
				jumpIds: [],
				notes: null,
				rdpRemoteApp: null,
				rdpRemoteAppDirectory: null,
				rdpRemoteAppArguments: null,
			});
			assert.equal(
				(await app.targets.credentials.set(target.id, target.version, { kind: 'ssh_key', sshKeyId: key.id }))
					.status,
				'updated',
			);
			return target;
		}

		try {
			app = await createApp(join(directory, 'state.db'), { encryptionKey: randomBytes(32) });
			address = await app.listenHttp({
				publicOrigin: origin,
				bindHost: '127.0.0.1',
				port: 0,
				trustedProxies: [],
			});
			const password = 'b10-upload-lifecycle-password';
			expectStatus(
				await api('POST', '/api/v1/auth/setup', { username: 'admin', password, confirmPassword: password }),
				201,
			);
			const login = await api('POST', '/api/v1/auth/login', { username: 'admin', password, rememberMe: false });
			expectStatus(login, 200);
			cookie = login.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
			const target = await installTarget(directory, 'healthy');
			const healthy = await connectWorkspace(target.id);
			const healthPath = join(directory, 'healthy.txt');
			await writeFile(healthPath, original);

			for (const mode of ['ready-cancel', 'partial-cancel', 'transport-loss', 'workspace-close']) {
				await t.test(mode, async () => {
					const root = join(directory, mode);
					await mkdir(root);
					const target = await installTarget(root, mode);
					const owner = await connectWorkspace(target.id);
					const { workspace, connection } = owner;
					const destinationPath = join(root, 'destination.bin');
					await writeFile(destinationPath, original);
					const uploadId = randomUUID();
					const input = { uploadId, destinationPath, size, conflictPolicy: 'overwrite' };
					const started = await workspace.call('upload.start', input);
					assert.equal(started.ok, true, JSON.stringify(started));
					const ready = await uploadEvent(workspace, uploadId, ['ready', 'failed']);
					assert.equal(ready.payload.type, 'ready', JSON.stringify(ready));
					const names = await readdir(root);
					const stages = names.filter((name) => name.startsWith('.nexus-upload-'));
					assert.equal(stages.length, 1, JSON.stringify(names));
					const stage = join(root, stages[0]);
					await until(
						() => openFileHandles(stage),
						(holders) => holders.length > 0,
						'Actual SFTP stage handle',
					);
					let stream;
					if (mode !== 'ready-cancel') {
						stream = await connectStream(connection, uploadId);
						stream.socket.send(chunk);
						const progress = await uploadEvent(workspace, uploadId, ['progress', 'failed']);
						assert.equal(progress.payload.type, 'progress', JSON.stringify(progress));
						assert.equal(progress.payload.bytesWritten, chunk.length);
						assert.deepEqual(
							await readFile(stage),
							chunk,
							'OS bytes prove the acknowledged write was dispatched',
						);
					}
					assert.deepEqual(await readFile(destinationPath), original);
					expectedShutdownFailure = true;
					if (mode === 'workspace-close') {
						const result = await closeWorkspace(owner);
						assert.equal(result.ok, false, JSON.stringify(result));
						assert.equal(result.error, 'operation_unknown');
					} else {
						if (mode === 'transport-loss') {
							stream.socket.terminate();
							await stream.closed;
						} else {
							const cancelled = await workspace.call('upload.cancel', { uploadId });
							assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
							assert.equal(cancelled.data, true);
						}
						const terminal = await uploadEvent(workspace, uploadId, ['failed', 'cancelled', 'completed']);
						assert.equal(terminal.payload.type, 'failed', JSON.stringify(terminal));
						assert.equal(terminal.payload.message, 'operation_unknown');
						const reused = await workspace.call('upload.start', input);
						assert.equal(reused.ok, false, JSON.stringify(reused));
						assert.equal(
							reused.error,
							'conflict',
							'unconfirmed cleanup retains the original task identity',
						);
						assert.deepEqual(await workspace.read(healthPath, 1024), original);
						if (mode === 'ready-cancel') {
							const peer = await connectWorkspace(target.id);
							assert.deepEqual(await peer.workspace.read(healthPath, 1024), original);
							const blockedId = randomUUID();
							assert.equal(
								(
									await peer.workspace.call('upload.start', {
										...input,
										uploadId: blockedId,
										destinationPath: join(root, 'other.bin'),
									})
								).ok,
								true,
							);
							const blocked = await uploadEvent(peer.workspace, blockedId, ['failed', 'ready']);
							assert.equal(blocked.payload.type, 'failed', JSON.stringify(blocked));
							assert.equal(
								blocked.payload.message,
								'conflict',
								'unknown effects fence this host across Workspaces',
							);
							await assert.rejects(readFile(join(root, 'other.bin')), { code: 'ENOENT' });
							assert.equal(
								(await readdir(root)).filter((name) => name.startsWith('.nexus-upload-')).length,
								1,
							);
							assert.equal((await closeWorkspace(peer)).ok, true);
						}
					}
					await until(
						() => openFileHandles(stage),
						(holders) => holders.length === 0,
						'Original SFTP handle closed',
					);
					assert.deepEqual(await readFile(stage), mode === 'ready-cancel' ? Buffer.alloc(0) : chunk);
					assert.deepEqual(await readFile(destinationPath), original, 'no incomplete upload is published');
					assert.deepEqual(await healthy.workspace.read(healthPath, 1024), original);
					if (mode === 'ready-cancel') {
						const stale = await connectStream(connection, uploadId);
						assert.equal((await stale.closed)[0], 1008);
					} else if (mode !== 'transport-loss') {
						stream.socket.send(Buffer.from('late byte'));
						assert.equal((await stream.closed)[0], 1011);
						assert.deepEqual(await readFile(stage), chunk, 'late bytes must not reach the retired upload');
					}
					if (mode !== 'workspace-close') {
						const closed = await closeWorkspace(owner);
						assert.equal(closed.ok, false, JSON.stringify(closed));
						assert.equal(closed.error, 'operation_unknown', 'closed SSH does not confirm stage cleanup');
					}
				});
			}

			await t.test('healthy Workspace still uploads exact bytes and closes normally', async () => {
				assert.equal(
					(
						await healthy.workspace.call('terminal.input', {
							data: "printf '%s%s\\n' 'B10_UPLOAD_' 'HEALTHY'\n",
						})
					).ok,
					true,
				);
				await until(
					() => Buffer.concat(healthy.workspace.terminal).toString('utf8'),
					(text) => text.includes('B10_UPLOAD_HEALTHY'),
					'Original healthy PTY output',
				);
				const destinationPath = join(directory, 'healthy-upload.bin');
				const uploadId = randomUUID();
				assert.equal(
					(
						await healthy.workspace.call('upload.start', {
							uploadId,
							destinationPath,
							size: chunk.length,
							conflictPolicy: 'overwrite',
						})
					).ok,
					true,
				);
				assert.equal(
					(await uploadEvent(healthy.workspace, uploadId, ['ready', 'failed'])).payload.type,
					'ready',
				);
				const stream = await connectStream(healthy.connection, uploadId, chunk.length);
				stream.socket.send(chunk);
				assert.equal((await stream.closed)[0], 1000);
				const terminal = await uploadEvent(healthy.workspace, uploadId, ['completed', 'failed']);
				assert.equal(terminal.payload.type, 'completed', JSON.stringify(terminal));
				assert.deepEqual(await readFile(destinationPath), chunk);
				assert.deepEqual(await healthy.workspace.read(destinationPath, chunk.length), chunk);
				assert.equal((await closeWorkspace(healthy)).ok, true);
			});
		} finally {
			for (const stream of streams) {
				stream.terminate();
			}
			const cleanup = await Promise.allSettled(workspaces.map((workspace) => workspace.close()));
			try {
				if (app) {
					if (expectedShutdownFailure) {
						await assert.rejects(
							app.close(),
							(error) => hasCleanupFailure(error) && hasOnlyExpectedShutdownFailures(error),
						);
					} else {
						await app.close();
					}
				}
			} finally {
				try {
					const results = await Promise.allSettled(daemons.map((daemon) => daemon.close()));
					const failures = results
						.filter((result) => result.status === 'rejected')
						.map((result) => result.reason);
					if (failures.length) {
						throw new AggregateError(failures, 'Upload SSH daemon cleanup failed');
					}
				} finally {
					await rm(directory, { recursive: true, force: true });
				}
			}
			const failures = cleanup.filter((result) => result.status === 'rejected').map((result) => result.reason);
			if (failures.length) {
				throw new AggregateError(failures, 'Upload fixture Workspace cleanup failed');
			}
		}
	},
);
