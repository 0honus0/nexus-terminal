import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import {
	mkdtemp,
	mkdir,
	readFile,
	writeFile,
	readdir,
	rm,
	chmod,
	utimes,
	symlink,
	readlink,
	link,
	stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from '../../../packages/backend/node_modules/ws/index.js';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';

import { origin, until, send, expectStatus, openSshd, openWorkspace } from './openssh-fixture.mjs';

await test(
	'B10 installed backend-next with OS OpenSSH, real SFTP, PTY and native archives',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-openssh-'));
		let sshd;
		let app;
		let workspace;
		let address;
		let cookie = '';
		let resource;
		let target;
		let connection;
		const root = join(directory, 'remote');
		const source = join(root, "中文 data ' [$];$(noop).txt");
		const content = 'B10真实SFTP\r\nfirst line\nlast line\n';

		const api = (method, path, input, headers) => send(address, cookie, method, path, input, headers);

		const file = (action, input) => api('POST', `/api/v1/remote/files/resources/${resource.id}/${action}`, input);

		try {
			sshd = await openSshd(directory);
			await mkdir(root);
			app = await createApp(join(directory, 'state.db'), { encryptionKey: randomBytes(32) });
			address = await app.listenHttp({
				publicOrigin: origin,
				bindHost: '127.0.0.1',
				port: 0,
				trustedProxies: [],
			});
			const password = 'b10-real-openssh-password';
			expectStatus(
				await api('POST', '/api/v1/auth/setup', { username: 'admin', password, confirmPassword: password }),
				201,
			);
			const login = await api('POST', '/api/v1/auth/login', { username: 'admin', password, rememberMe: false });
			expectStatus(login, 200);
			cookie = login.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
			await app.targets.hostKeys.confirm({ host: '127.0.0.1', port: sshd.port, fingerprint: sshd.fingerprint });
			const key = await app.targets.sshKeys.create({
				name: 'B10 ephemeral OpenSSH',
				privateKey: sshd.privateKey,
			});
			target = await app.targets.create({
				name: 'B10 OS OpenSSH',
				type: 'SSH',
				host: '127.0.0.1',
				port: sshd.port,
				username: sshd.user,
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

			await t.test('HTTP real SFTP round trip, no-clobber, digest CAS, modes and cleanup', async () => {
				resource = expectStatus(
					await api('POST', '/api/v1/remote/files/resources', { targetId: target.id }),
					201,
				);
				const created = expectStatus(
					await file('write-text', { path: source, text: content, expectedSha256: null }),
					201,
				);
				assert.equal(created.status, 'created');
				assert.equal(await readFile(source, 'utf8'), content);
				const read = expectStatus(await file('read-text', { path: source }), 200);
				assert.equal(read.text, content);
				assert.equal(read.sha256, createHash('sha256').update(content).digest('hex'));
				assert.equal(
					expectStatus(
						await file('write-text', { path: source, text: 'do not overwrite', expectedSha256: null }),
						409,
					).code,
					'conflict',
				);
				assert.equal(
					expectStatus(
						await file('write-text', { path: source, text: 'stale', expectedSha256: '0'.repeat(64) }),
						409,
					).code,
					'conflict',
				);
				assert.equal(await readFile(source, 'utf8'), content);
				const changed = expectStatus(
					await file('write-text', {
						path: source,
						text: content + 'updated\n',
						expectedSha256: read.sha256,
					}),
					200,
				);
				assert.equal(changed.status, 'replaced');
				assert.equal(changed.info.mode & 0o777, created.info.mode & 0o777);
				expectStatus(
					await file('write-text', { path: source, text: content, expectedSha256: changed.sha256 }),
					200,
				);
				const disposable = join(root, 'temporary');
				expectStatus(await file('mkdir', { path: disposable }), 201);
				const before = join(disposable, 'before.txt');
				const after = join(disposable, 'after.txt');
				expectStatus(await file('write-text', { path: before, text: 'remove me', expectedSha256: null }), 201);
				expectStatus(await file('rename', { from: before, to: after }), 200);
				assert.deepEqual(await readdir(disposable), ['after.txt']);
				expectStatus(await file('remove', { path: after }), 200);
				expectStatus(await file('rmdir', { path: disposable }), 200);
				const listing = expectStatus(await file('list', { path: root }), 200);
				assert.deepEqual(
					listing.entries.map((entry) => entry.name),
					[source.slice(root.length + 1)],
				);
			});

			await t.test('Workspace uses a real PTY and NXW1 file bytes, rejecting an undersized read', async () => {
				workspace = await openWorkspace(address, cookie);
				const response = await workspace.call('workspace.connect', {
					workspaceId: randomUUID(),
					connectionId: target.id,
					viewport: { columns: 92, rows: 28 },
				});
				assert.equal(response.ok, true, JSON.stringify(response));
				connection = response.data;
				assert.equal(connection.binaryProtocolVersion, 1);
				await until(
					() =>
						workspace.events.find(
							(event) => event.type === 'filesystem.ready' || event.type === 'filesystem.error',
						),
					(event) => {
						if (event?.type === 'filesystem.error') {
							assert.fail(JSON.stringify(event));
						}
						return event?.type === 'filesystem.ready';
					},
					'Workspace SFTP readiness',
				);
				assert.equal(
					(await workspace.call('terminal.input', { data: "printf '%s%s\\n' 'B10_' 'PTY_OK'\n" })).ok,
					true,
				);
				await until(
					() => Buffer.concat(workspace.terminal).toString('utf8'),
					(text) => text.includes('B10_PTY_OK'),
					'PTY command output',
				);
				assert.deepEqual(await workspace.read(source, Buffer.byteLength(content)), Buffer.from(content));
				const refused = await workspace.call('filesystem.readBinary', {
					path: source,
					maxBytes: Buffer.byteLength(content) - 1,
				});
				assert.equal(refused.ok, false);
				assert.deepEqual(await workspace.read(source, Buffer.byteLength(content)), Buffer.from(content));
			});

			await t.test('Native zip and GNU tar formats round-trip quoted Unicode names and exact bytes', async () => {
				for (const format of ['zip', 'tar.gz', 'tar.bz2']) {
					const archive = join(root, 'roundtrip.' + format);
					const compressed = await workspace.archive('transfer.compress', {
						sources: [source],
						destination: archive,
						format,
					});
					assert.equal(compressed.payload.type, 'completed', JSON.stringify(compressed));
					assert.equal(compressed.payload.path, archive);
					expectStatus(await file('remove', { path: source }), 200);
					const extracted = await workspace.archive('transfer.decompress', { source: archive });
					assert.equal(extracted.payload.type, 'completed', JSON.stringify(extracted));
					assert.equal(await readFile(source, 'utf8'), content);
					assert.deepEqual(await workspace.read(source, Buffer.byteLength(content)), Buffer.from(content));
					expectStatus(await file('remove', { path: archive }), 200);
				}
				assert.deepEqual(await readdir(root), [source.slice(root.length + 1)]);
			});

			await t.test(
				'Encrypted ZIP rejects wrong password without publishing and restores with quoted password',
				async () => {
					const archive = join(root, 'encrypted.zip');
					const password = "B10 p' a$;[]";
					const compressed = await workspace.archive('transfer.compress', {
						sources: [source],
						destination: archive,
						format: 'zip',
						password,
					});
					assert.equal(compressed.payload.type, 'completed', JSON.stringify(compressed));
					expectStatus(await file('remove', { path: source }), 200);
					const refused = await workspace.archive('transfer.decompress', {
						source: archive,
						password: 'incorrect',
					});
					assert.equal(refused.payload.type, 'failed', JSON.stringify(refused));
					assert.equal(refused.payload.code, 'INVALID_PASSWORD');
					assert.deepEqual(await readdir(root), ['encrypted.zip']);
					const extracted = await workspace.archive('transfer.decompress', { source: archive, password });
					assert.equal(extracted.payload.type, 'completed', JSON.stringify(extracted));
					assert.equal(await readFile(source, 'utf8'), content);
					expectStatus(await file('remove', { path: archive }), 200);
				},
			);

			await t.test(
				'Native archives preserve relative links, TAR hardlinks and directory/file modes',
				async () => {
					const tree = join(root, 'tree [link]');
					for (const format of ['zip', 'tar.gz']) {
						await mkdir(tree);
						await writeFile(join(tree, 'data.txt'), content);
						await chmod(join(tree, 'data.txt'), 0o640);
						await utimes(join(tree, 'data.txt'), 1700000000, 1700000000);
						await symlink('data.txt', join(tree, 'symbolic'));
						if (format !== 'zip') {
							await link(join(tree, 'data.txt'), join(tree, 'hard'));
						}
						await chmod(tree, 0o555);
						const archive = join(root, 'links.' + format);
						const compressed = await workspace.archive('transfer.compress', {
							sources: [tree],
							destination: archive,
							format,
						});
						assert.equal(compressed.payload.type, 'completed', JSON.stringify(compressed));
						assert.equal(
							(await workspace.call('filesystem.remove', { paths: [tree], forceDirectoryPaths: [tree] }))
								.ok,
							true,
						);
						const extracted = await workspace.archive('transfer.decompress', { source: archive });
						assert.equal(extracted.payload.type, 'completed', JSON.stringify(extracted));
						assert.equal(await readlink(join(tree, 'symbolic')), 'data.txt');
						assert.equal(await readFile(join(tree, 'symbolic'), 'utf8'), content);
						const metadata = await stat(join(tree, 'data.txt'));
						assert.equal(metadata.mode & 0o777, 0o640);
						assert.equal(metadata.mtimeMs, 1700000000000);
						assert.equal((await stat(tree)).mode & 0o777, 0o555);
						if (format !== 'zip') {
							assert.equal((await stat(join(tree, 'hard'))).ino, metadata.ino);
						}
						assert.equal(
							(await workspace.call('filesystem.remove', { paths: [tree], forceDirectoryPaths: [tree] }))
								.ok,
							true,
						);
						expectStatus(await file('remove', { path: archive }), 200);
					}
				},
			);

			await t.test(
				'Traversal archive is refused before publication and private snapshots are removed',
				async () => {
					const archive = join(root, 'traversal.tar.gz');
					const fixture = join(directory, 'hostile-member');
					await writeFile(fixture, 'must remain outside extraction');
					execFileSync('tar', ['-czf', archive, '--transform=s,^,../,', '-C', directory, 'hostile-member']);
					const rejected = await workspace.archive('transfer.decompress', { source: archive });
					assert.equal(rejected.payload.type, 'failed', JSON.stringify(rejected));
					assert.equal(rejected.payload.message, 'invalid_input');
					assert.equal(await readFile(fixture, 'utf8'), 'must remain outside extraction');
					expectStatus(await file('remove', { path: archive }), 200);
					assert.deepEqual(await readdir(root), [source.slice(root.length + 1)]);
				},
			);

			await t.test(
				'Binary upload streams multiple chunks and cross-Workspace copy/move confirms actual bytes',
				async () => {
					const uploadedPath = join(root, 'uploaded.bin');
					const bytes = randomBytes(2 * 1024 * 1024 + 37);
					const uploadId = randomUUID();
					const started = await workspace.call('upload.start', {
						uploadId,
						destinationPath: uploadedPath,
						size: bytes.length,
						conflictPolicy: 'overwrite',
					});
					assert.equal(started.ok, true, JSON.stringify(started));
					const ready = await until(
						() =>
							workspace.events.find(
								(event) =>
									event.type === 'transfer.upload' &&
									event.payload.uploadId === uploadId &&
									['ready', 'failed', 'cancelled'].includes(event.payload.type),
							),
						Boolean,
						'Upload ready',
					);
					assert.equal(ready.payload.type, 'ready', JSON.stringify(ready));
					const query = new URLSearchParams({
						workspaceId: connection.workspaceId,
						uploadId,
						size: String(bytes.length),
					});
					const stream = new WebSocket('ws://' + address + '/ws/uploads?' + query, {
						origin,
						headers: { Host: new URL(origin).host, Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' },
					});
					try {
						const closed = once(stream, 'close');
						await once(stream, 'open');
						for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
							stream.send(bytes.subarray(offset, offset + 256 * 1024));
						}
						assert.equal((await closed)[0], 1000);
					} finally {
						stream.terminate();
					}
					const upload = await until(
						() =>
							workspace.events.find(
								(event) =>
									event.type === 'transfer.upload' &&
									event.payload.uploadId === uploadId &&
									['completed', 'failed', 'cancelled'].includes(event.payload.type),
							),
						Boolean,
						'Upload complete',
					);
					assert.equal(upload.payload.type, 'completed', JSON.stringify(upload));
					assert.deepEqual(await readFile(uploadedPath), bytes);
					assert.deepEqual(await workspace.read(uploadedPath, bytes.length), bytes);
					const destination = join(root, 'copy-target');
					expectStatus(await file('mkdir', { path: destination }), 201);
					const other = await openWorkspace(address, cookie);
					try {
						const opened = await other.call('workspace.connect', {
							workspaceId: randomUUID(),
							connectionId: target.id,
						});
						assert.equal(opened.ok, true, JSON.stringify(opened));
						await until(
							() => other.events.find((event) => event.type === 'filesystem.ready'),
							Boolean,
							'Destination SFTP ready',
						);

						const copied = await other.copyMove({
							mode: 'copy',
							sources: [uploadedPath],
							destination,
							sourceWorkspaceId: connection.workspaceId,
						});
						assert.equal(copied.crossSession, true);
						assert.deepEqual(await readFile(join(destination, 'uploaded.bin')), bytes);
						assert.deepEqual(await readFile(uploadedPath), bytes);
						await writeFile(join(destination, 'uploaded.bin'), 'old destination content');
						await other.copyMove({
							mode: 'move',
							sources: [uploadedPath],
							destination,
							sourceWorkspaceId: connection.workspaceId,
						});
						assert.deepEqual(await readFile(join(destination, 'uploaded.bin')), bytes);
						await assert.rejects(readFile(uploadedPath), { code: 'ENOENT' });
						const mergeSource = join(root, 'merged');
						const mergeDestination = join(destination, 'merged');
						await mkdir(mergeSource);
						await mkdir(mergeDestination);
						await writeFile(join(mergeSource, 'new.txt'), 'new source content');
						await writeFile(join(mergeDestination, 'retained.txt'), 'retain destination content');
						await other.copyMove({
							mode: 'move',
							sources: [mergeSource],
							destination,
							sourceWorkspaceId: connection.workspaceId,
						});
						assert.equal(await readFile(join(mergeDestination, 'new.txt'), 'utf8'), 'new source content');
						assert.equal(
							await readFile(join(mergeDestination, 'retained.txt'), 'utf8'),
							'retain destination content',
						);
						await assert.rejects(stat(mergeSource), { code: 'ENOENT' });
						const closed = await other.call('workspace.close', {
							workspaceId: opened.data.workspaceId,
							connectionId: target.id,
							resumeToken: opened.data.resumeToken,
							attachmentGeneration: opened.data.attachmentGeneration,
						});
						assert.equal(closed.ok, true, JSON.stringify(closed));
					} finally {
						await other.close();
					}
					assert.equal(
						(
							await workspace.call('filesystem.remove', {
								paths: [destination],
								forceDirectoryPaths: [destination],
							})
						).ok,
						true,
					);
				},
			);

			await t.test(
				'Real SFTP download Range and ticket, Workspace close and released resource refusal',
				async () => {
					const query = new URLSearchParams({
						sessionId: connection.workspaceId,
						connectionId: String(target.id),
						remotePath: source,
					});
					const ranged = await api('GET', '/api/v1/sftp/download?' + query, undefined, {
						Range: 'bytes=2-13',
					});
					expectStatus(ranged, 206);
					assert.deepEqual(ranged.bytes, Buffer.from(content).subarray(2, 14));
					assert.equal(ranged.headers['content-range'], `bytes 2-13/${Buffer.byteLength(content)}`);
					const ticket = expectStatus(
						await api('POST', '/api/v1/sftp/download-ticket', {
							sessionId: connection.workspaceId,
							connectionId: target.id,
							remotePath: source,
						}),
						201,
					);
					const downloaded = await api('GET', ticket.url);
					expectStatus(downloaded, 200);
					assert.deepEqual(downloaded.bytes, Buffer.from(content));
					const closed = await workspace.call('workspace.close', {
						workspaceId: connection.workspaceId,
						connectionId: target.id,
						resumeToken: connection.resumeToken,
						attachmentGeneration: connection.attachmentGeneration,
					});
					assert.equal(closed.ok, true, JSON.stringify(closed));
					expectStatus(await api('DELETE', `/api/v1/remote/files/resources/${resource.id}`), 200);
					assert.equal(expectStatus(await file('stat', { path: source }), 404).code, 'not_found');
				},
			);
		} finally {
			const cleanup = await Promise.allSettled([
				Promise.resolve().then(() => workspace?.close()),
				Promise.resolve().then(() => app?.close()),
			]);
			try {
				await sshd?.close();
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
			const failures = cleanup.filter((result) => result.status === 'rejected').map((result) => result.reason);
			if (failures.length) {
				throw new AggregateError(failures, 'OpenSSH integration cleanup failed');
			}
		}
	},
);
