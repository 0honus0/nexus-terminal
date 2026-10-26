import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable, PassThrough } from 'node:stream';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';
import { origin, send, expectStatus, openSshd, until } from './openssh-fixture.mjs';
import {
	readServerTransferInput,
	readServerTransferSnapshot,
	readServerTransferPage,
} from '../../../packages/shared/dist/remote/transfers/server-codec.js';
import { ServerTransferService } from '../../../packages/backend/dist/modules/remote/transfers/service/server-transfer-service.js';
import { ServerTransferFailure } from '../../../packages/backend/dist/modules/remote/transfers/model/server-transfer-types.js';

await test(
	'server-transfer strict contracts and actual two-endpoint source-side SCP/rsync',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(join(tmpdir(), 'nexus-c2-server-transfer-'));
		const sourceDir = join(directory, 'source');
		const targetDir = join(directory, 'target');
		await mkdir(sourceDir);
		await mkdir(targetDir);
		const daemons = [];
		let app;
		let cookie = '';
		let address;

		const api = (method, path, body) => send(address, cookie, method, '/api/v1/transfers' + path, body);

		try {
			daemons.push(await openSshd(sourceDir));
			daemons.push(await openSshd(targetDir));
			app = await createApp(join(directory, 'state.db'), { encryptionKey: randomBytes(32) });
			address = await app.listenHttp({
				publicOrigin: origin,
				bindHost: '127.0.0.1',
				port: 0,
				trustedProxies: [],
			});
			const password = 'isolated-transfer-admin-password';
			expectStatus(
				await send(address, '', 'POST', '/api/v1/auth/setup', {
					username: 'admin',
					password,
					confirmPassword: password,
				}),
				201,
			);
			const login = await send(address, '', 'POST', '/api/v1/auth/login', {
				username: 'admin',
				password,
				rememberMe: false,
			});
			expectStatus(login, 200);
			cookie = login.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
			const ids = [];
			for (const [index, ssh] of daemons.entries()) {
				let privateKey = ssh.privateKey;
				const passphrase = index === 1 ? 'isolated key passphrase' : null;
				if (passphrase) {
					execFileSync('ssh-keygen', [
						'-q',
						'-p',
						'-P',
						'',
						'-N',
						passphrase,
						'-f',
						join(targetDir, 'client'),
					]);
					privateKey = await readFile(join(targetDir, 'client'), 'utf8');
				}
				await app.targets.hostKeys.confirm({ host: '127.0.0.1', port: ssh.port, fingerprint: ssh.fingerprint });
				const key = await app.targets.sshKeys.create({
					name: 'transfer-key-' + index,
					privateKey,
					passphrase,
				});
				const target = await app.targets.create({
					name: 'transfer-' + index,
					type: 'SSH',
					host: '127.0.0.1',
					port: ssh.port,
					username: ssh.user,
					route: 'direct',
					proxyId: null,
					tagIds: [],
					jumpIds: [],
					notes: null,
				});
				assert.equal(
					(
						await app.targets.credentials.set(target.id, target.version, {
							kind: 'ssh_key',
							sshKeyId: key.id,
						})
					).status,
					'updated',
				);
				ids.push(target.id);
			}
			const filename = "中文 ' [$];$(not-executed).txt";
			await writeFile(join(sourceDir, filename), 'source-side exact bytes\n');
			await mkdir(join(sourceDir, 'tree'));
			await writeFile(join(sourceDir, 'tree', 'nested.txt'), 'nested');

			const command = (method, destination) => ({
				sourceConnectionId: ids[0],
				connectionIds: [ids[1]],
				sourceItems: [
					{ name: filename, path: join(sourceDir, filename), type: 'file' },
					{ name: 'tree', path: join(sourceDir, 'tree'), type: 'directory' },
				],
				remoteTargetPath: destination,
				transferMethod: method,
			});

			await t.test(
				'strict inputs reject aliases, duplicate names, nesting, invalid UTF-16 and unknown fields',
				() => {
					const valid = command('auto', join(targetDir, 'out'));
					assert.deepEqual(readServerTransferInput(valid), valid);
					for (const value of [
						{ ...valid, extra: true },
						{ ...valid, connectionIds: [ids[0]] },
						{ ...valid, connectionIds: [ids[1], ids[1]] },
						{
							...valid,
							sourceItems: [
								{ name: 'tree', path: join(sourceDir, 'tree'), type: 'directory' },
								{ name: 'nested.txt', path: join(sourceDir, 'tree/nested.txt'), type: 'file' },
							],
						},
						{ ...valid, remoteTargetPath: '/tmp/../out' },
						{ ...valid, remoteTargetPath: '/tmp/\ud800' },
					]) {
						assert.throws(() => readServerTransferInput(value));
					}
				},
			);
			await t.test(
				'five real routes, three transfer choices, directory shape, quoting, cleanup and paging',
				async () => {
					const completedIds = [];
					for (const method of ['scp', 'rsync', 'auto']) {
						const destination = join(targetDir, method + " ' destination");
						const task = readServerTransferSnapshot(
							expectStatus(await api('POST', '/send', command(method, destination)), 202),
						);
						assert.equal(task.status, 'queued');
						const settled = await until(
							async () =>
								readServerTransferSnapshot(
									expectStatus(await api('GET', '/status/' + task.taskId), 200),
								),
							(value) => ['completed', 'failed', 'unknown', 'partially-completed'].includes(value.status),
							'real server transfer',
						);
						assert.equal(settled.status, 'completed', JSON.stringify(settled));
						assert.equal(await readFile(join(destination, filename), 'utf8'), 'source-side exact bytes\n');
						assert.equal(await readFile(join(destination, 'tree', 'nested.txt'), 'utf8'), 'nested');
						assert.equal(
							settled.subTasks.every(
								(item) => item.transferMethodUsed === (method === 'auto' ? 'rsync' : method),
							),
							true,
						);
						for (const item of task.subTasks) {
							assert.equal((await readdir('/tmp')).includes('nexus-transfer-' + item.subTaskId), false);
						}
						completedIds.push(task.taskId);
					}
					const list = readServerTransferPage(expectStatus(await api('GET', '/status'), 200));
					assert.equal(list.items.length, 3);
					assert.equal(list.nextCursor, null);
					assert.equal(JSON.stringify(list).includes('PRIVATE KEY'), false);
					assert.equal(JSON.stringify(list).includes(password), false);
					expectStatus(await api('POST', '/cancel/' + completedIds[0]), 404);
					expectStatus(await api('DELETE', '/' + completedIds[0]), 204);
					expectStatus(await api('GET', '/status/' + completedIds[0]), 404);
					expectStatus(await api('GET', '/status/' + randomUUID()), 404);
					expectStatus(await api('GET', '/status?limit=9'), 400);
				},
			);
			await t.test('missing trust is a pre-dispatch refusal and cannot create destination', async () => {
				await app.targets.hostKeys.remove('127.0.0.1', daemons[1].port);
				const refused = expectStatus(
					await api('POST', '/send', command('scp', join(targetDir, 'untrusted'))),
					422,
				);
				assert.equal(refused.code, 'host_key_untrusted');
				assert.equal((await readdir(targetDir)).includes('untrusted'), false);
			});
			await t.test('management authentication is mandatory', async () => {
				expectStatus(await send(address, '', 'GET', '/api/v1/transfers/status'), 401);
			});
		} finally {
			const failures = [];
			try {
				await app?.close();
			} catch (error) {
				failures.push(error);
			}
			for (const daemon of daemons) {
				try {
					await daemon.close();
				} catch (error) {
					failures.push(error);
				}
			}
			await rm(directory, { recursive: true, force: true });
			if (failures.length) throw new AggregateError(failures, 'server transfer test cleanup failed');
		}
	},
);

await test(
	'background cancellation retains actual execution ownership and never publishes false cancelled',
	{ timeout: 10000 },
	async () => {
		let release;
		let started;
		const began = new Promise((resolve) => {
			started = resolve;
		});
		const execution = new Promise((resolve) => {
			release = resolve;
		});
		let calls = 0;
		const plan = {
			source: { targetId: 1, fingerprint: 'source' },
			targets: [
				{ targetId: 2, fingerprint: 'target', hostKeyFingerprint: 'pin', pinKey: 'target:22', direct: true },
			],
			sourcePin: { key: 'source:22', fingerprint: 'pin' },
			resources: ['source:22', 'target:22'],
		};
		const model = {
			digest: () => 'a'.repeat(64),

			prepare: async () => plan,

			validate: async () => {},

			execute: async (input) => {
				calls += 1;
				input.onMethod('scp');
				started();
				await execution;
				throw new ServerTransferFailure('operation_unknown', 'unknown');
			},
		};
		const access = {
			authenticate: async () => ({ userId: 1 }),

			authenticateDigest: async () => ({ userId: 1 }),
		};
		const mutations = {
			ownExecution: (work) => Promise.resolve().then(work),

			run: (_id, _origin, _targets, work) => work(),
		};
		const files = {
			async open(targetId) {
				return {
					targetId,
					fingerprint: targetId === 1 ? 'source' : 'target',

					stat: async ({ path }) => ({
						kind: path.endsWith('/a') ? 'file' : 'directory',
						size: 1,
						mode: 0o644,
						modifiedAt: 1,
						accessedAt: 1,
						uid: 0,
						gid: 0,
					}),

					close: async () => {},
				};
			},

			copyDirect: async (input) => {
				input.onMutation();
				return model.execute(input);
			},
		};
		const service = new ServerTransferService(access, model, mutations, files);
		const payload = {
			sourceConnectionId: 1,
			connectionIds: [2],
			sourceItems: [{ name: 'a', path: '/tmp/a', type: 'file' }],
			remoteTargetPath: '/tmp/out',
			transferMethod: 'scp',
		};
		const task = await service.send('token', async () => payload, new AbortController().signal);
		await began;
		const queued = await service.send('token', async () => payload, new AbortController().signal);
		await service.cancel('token', queued.taskId);
		assert.equal((await service.details('token', queued.taskId)).status, 'cancelled');
		await service.cancel('token', task.taskId);
		assert.equal((await service.details('token', task.taskId)).status, 'cancelling');
		await assert.rejects(service.remove('token', task.taskId), (error) => error.code === 'resource_active');
		release();
		const final = await until(
			() => service.details('token', task.taskId),
			(task) => task.status === 'unknown',
			'cancel outcome',
		);
		assert.equal(final.subTasks[0].status, 'unknown');
		assert.equal(calls, 1);
		await assert.rejects(service.remove('token', task.taskId), (error) => error.code === 'resource_active');
		const firstClose = service.close();
		assert.equal(service.close(), firstClose);
		await assert.rejects(firstClose);
	},
);

await test('background claim transaction rechecks original identity, exits request scope and preserves unknown across restart', async () => {
	const { SqliteRuntime } = await import('../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js');
	const { initializeMachineMutations } =
		await import('../../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-schema.js');
	const { SqliteMachineMutationStorage } =
		await import('../../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-sql.js');
	const { MachineMutationModel } =
		await import('../../../packages/backend/dist/modules/remote/machines/model/mutation-model.js');
	const { MachineMutationService } =
		await import('../../../packages/backend/dist/modules/remote/machines/service/mutation-service.js');
	const { SecureSessionTokens } =
		await import('../../../packages/backend/dist/platform/security/adapters/secure-session-tokens.js');
	const directory = await mkdtemp(join(tmpdir(), 'nexus-c2-server-claim-'));
	const path = join(directory, 'state.db');
	let db = SqliteRuntime.open(path);
	try {
		await initializeMachineMutations(db);
		let identity = 1;
		const storage = new SqliteMachineMutationStorage(db);
		storage.installTransactionIdentityReader(async (_tx, digest) => {
			assert.equal(digest, 'a'.repeat(64));
			return identity;
		});
		const resolver = { resolveStored: async ({ targetId }) => ({ host: 'machine-' + targetId, port: 22 }) };
		const owner = new MachineMutationService(
			new MachineMutationModel(storage, resolver, new SecureSessionTokens()),
		);
		const targets = [1, 2].map((targetId) => ({ targetId, fingerprint: 'f'.repeat(64) }));
		const actor = { userId: 1, digest: 'a'.repeat(64) };
		let executed = 0;
		await db.withTransactionAdmission(
			async () => {
				throw new Error('request admission must not be inherited');
			},
			() =>
				owner.ownExecution(async () => {
					await owner.run(
						'server-transfer:' + randomUUID(),
						'files',
						targets,
						async () => {
							executed += 1;
						},
						actor,
					);
				}),
		);
		assert.equal(executed, 1);
		identity = null;
		await assert.rejects(
			owner.run(
				'server-transfer:' + randomUUID(),
				'files',
				targets,
				async () => {
					executed += 1;
				},
				actor,
			),
			(error) => error.code === 'unauthenticated',
		);
		assert.equal(executed, 1);
		assert.equal((await db.all('SELECT * FROM remote_machine_mutation_claims')).length, 0);
		identity = 1;
		const claim = 'server-transfer:' + randomUUID();
		await assert.rejects(
			owner.run(
				claim,
				'files',
				targets,
				async () => {
					throw new ServerTransferFailure('operation_unknown', 'unknown');
				},
				actor,
			),
			(error) => error.code === 'operation_unknown',
		);
		assert.equal(
			(await db.one('SELECT state FROM remote_machine_mutation_claims WHERE id=?', [claim])).state,
			'blocked',
		);
		await db.close();
		db = SqliteRuntime.open(path);
		const reopened = new SqliteMachineMutationStorage(db);
		await reopened.reconcile(Date.now());
		assert.equal(
			(await db.one('SELECT state FROM remote_machine_mutation_claims WHERE id=?', [claim])).state,
			'blocked',
		);
		assert.equal((await db.all('SELECT * FROM remote_machine_mutations')).length, 2);
	} finally {
		await db.close();
		await rm(directory, { recursive: true, force: true });
	}
});

await test('native secret cleanup and pinned handshake evidence remain independent of execution outcome', async () => {
	const { NativeServerTransfer } =
		await import('../../../packages/backend/dist/platform/transfers/adapters/native-transfer.js');
	const { NativeTransferFailure } =
		await import('../../../packages/backend/dist/platform/transfers/transfer-port.js');
	const { createHash } = await import('node:crypto');
	const algorithm = Buffer.from('ssh-ed25519');
	const size = Buffer.alloc(4);
	size.writeUInt32BE(algorithm.length);
	const key = Buffer.concat([size, algorithm, Buffer.from([0, 0, 0, 32]), randomBytes(32)]);
	for (const scenario of ['cleanup_failure', 'cancel_after_dispatch', 'progress_setup_failure', 'wrong_key']) {
		const controller = new AbortController();
		let writes = 0;
		let closed = 0;
		let cleanup = 0;
		let dispatched = 0;
		let cancelled = 0;
		const completed = {
			outcome: { status: 'completed', exitCode: 0, signal: null },
			stdout: '',
			stderr: '',
			truncated: false,
		};
		const machine = {
			async execute(command, options) {
				if (command.startsWith('rm -f')) {
					cleanup += 1;
					assert.equal(options.signal, undefined, 'cleanup must survive original cancellation');
					return scenario === 'cleanup_failure'
						? { ...completed, outcome: { status: 'nonzero', exitCode: 1, signal: null } }
						: completed;
				}

				return completed;
			},

			async openRawCommand(command) {
				assert.ok(command.startsWith('LC_ALL=C rsync -aWs'));
				dispatched++;
				if (scenario === 'cancel_after_dispatch') controller.abort();
				return {
					writable: new PassThrough(),

					onStderr: () => {
						if (scenario === 'progress_setup_failure') throw new Error('fixture progress setup');
						return () => {};
					},

					readable: Readable.from([' 1,024 50% 1.00MB/s 0:00:01\r', ' 2,048 100% 1.00MB/s 0:00:00\n']),
					outcome: Promise.resolve(
						scenario === 'cancel_after_dispatch'
							? { status: 'unknown', reason: 'cancelled' }
							: completed.outcome,
					),

					cancel() {
						cancelled++;
					},
				};
			},

			async openSftp() {
				return {
					lstat: async () => ({ isSymbolicLink: false, isFile: true, isDirectory: false }),

					writeFile: async (_path, _bytes, options) => {
						writes += 1;
						assert.equal(options.flags, 'wx');
						assert.equal(options.mode, 0o600);
					},

					close: async () => {
						closed += 1;
					},
				};
			},
		};
		const failure = await new NativeServerTransfer()
			.execute({
				executionId: randomUUID(),
				source: machine,
				target: machine,
				host: 'example.test',
				port: 22,
				username: 'test',
				authentication: { kind: 'private_key', privateKey: 'isolated fixture secret', passphrase: null },
				hostKeyFingerprint:
					scenario === 'wrong_key'
						? 'wrong'
						: 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/u, ''),
				hostPublicKey: key,
				sourcePath: '/tmp/a',
				directory: false,
				targetDirectory: '/tmp/out',
				method: 'rsync',
				deadline: Date.now() + 10000,
				signal: controller.signal,

				validate: async () => controller.signal.throwIfAborted(),

				onMethod: () => {},

				onProgress: () => {},

				onMutation: () => {},
			})
			.catch((error) => error);
		assert.ok(failure instanceof NativeTransferFailure);
		if (scenario === 'wrong_key') {
			assert.equal(failure.reason, 'host_key_rejected');
			assert.equal(failure.outcome, 'not_started');
			assert.equal(writes, 0);
			assert.equal(dispatched, 0);
		} else {
			assert.equal(failure.outcome, 'unknown');
			assert.equal(writes, 2);
			assert.equal(dispatched, 1);
			assert.equal(cleanup, 1);
			assert.equal(closed, 1);
			if (scenario === 'progress_setup_failure') assert.equal(cancelled, 1);
		}
	}
});
