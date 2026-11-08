import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { RemoteMachineModel } from '../../../../../../packages/backend/dist/modules/remote/machines/model/machine-model.js';
import { RemoteMachineScopeModel } from '../../../../../../packages/backend/dist/modules/remote/machines/model/machine-scope-model.js';
import { MachineCommandModel } from '../../../../../../packages/backend/dist/modules/remote/machines/model/command-model.js';
import { RemoteMachineOperationService } from '../../../../../../packages/backend/dist/modules/remote/machines/service/operation-service.js';
import { RemoteMachineOperationFactoryService } from '../../../../../../packages/backend/dist/modules/remote/machines/service/operation-factory-service.js';
import { RemoteFileModel } from '../../../../../../packages/backend/dist/modules/remote/files/model/file-model.js';
import { ObservationModel } from '../../../../../../packages/backend/dist/modules/remote/monitoring/model/observation-model.js';
import { RemoteFileFailure } from '../../../../../../packages/backend/dist/modules/remote/files/model/file-types.js';
import { Ssh2MachineFactory } from '../../../../../../packages/backend/dist/platform/ssh/adapters/ssh2/ssh-machine.js';
import { PosixCommandAdapter } from '../../../../../../packages/backend/dist/platform/commands/adapters/posix-command.js';
import { TargetOperationError } from '../../../../../../packages/backend/dist/modules/targets/public-errors.js';
import { ToolModel } from '../../../../../../packages/backend/dist/modules/agent/tools/model/tool-model.js';
import { remoteOperationFactory } from '../../../../../../packages/backend/dist/modules/remote/operation-mapper.js';

const requireBackend = createRequire(new URL('../../../../../../packages/backend/package.json', import.meta.url));
const { Server, utils } = requireBackend('ssh2');
const { STATUS_CODE } = utils.sftp;
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
	type: 'pkcs1',
	format: 'pem',
});
const publicKey = utils.parseKey(privateKey).getPublicSSH();
const hostFingerprint = 'SHA256:' + createHash('sha256').update(publicKey).digest('base64').replace(/=+$/u, '');
const targetFingerprint = 'a'.repeat(64);
const fileBytes = Buffer.from('reused SFTP content\n');

const command = (script, cwd = null) => ({ commands: [{ kind: 'shell', script }], cwd, onError: 'stop' });

const scope = (signal = new AbortController().signal, validate = async () => {}) => ({
	operationId: randomUUID(),
	targetId: 1,
	fingerprint: targetFingerprint,
	timeoutMs: 10000,
	signal,
	validate,
});

async function fixture(t) {
	const peers = new Set();
	const children = new Set();
	const nativeMachines = new Set();
	const owned = [];
	const state = {
		connections: 0,
		sftp: 0,
		exec: 0,
		activeSftp: 0,
		processes: 0,
		held: [],
		holdPaths: false,
		pathEntered: Promise.withResolvers(),
		execEntered: Promise.withResolvers(),
	};

	const attrs = (path) => ({
		mode: path === '/' ? 0o40755 : 0o100644,
		size: path === '/' ? 0 : fileBytes.length,
		uid: 0,
		gid: 0,
		atime: 1,
		mtime: 1,
	});

	const server = new Server({ hostKeys: [privateKey] }, (client) => {
		state.connections++;
		peers.add(client);
		client.on('error', () => {});
		client.once('close', () => peers.delete(client));
		client.on('authentication', (auth) => (auth.method === 'password' ? auth.accept() : auth.reject()));
		client.on('ready', () =>
			client.on('session', (accept) => {
				const session = accept();
				session.on('exec', (accept, _reject, info) => {
					state.exec++;
					const channel = accept();
					channel.on('error', () => {});
					channel.on('end', () => channel.end());
					if (info.command.includes('__nexus_hold__')) {
						state.held.push(() => {
							channel.exit(0);
							channel.end('released');
						});
						if (info.command.includes('__nexus_bulk__')) {
							const prefix = info.command.match(/\u001eNEXUS_[a-f0-9]+:/u)?.[0];
							assert.ok(prefix);
							channel.write(prefix + '0:start\u001f');
							channel.stderr.write(prefix + '0:start\u001f');
							channel.write(Buffer.alloc(2 * 1024 * 1024, 98));
						}
						state.execEntered.resolve();
						return;
					}
					if (info.command.includes('__nexus_interactive__')) {
						state.processes++;
						let input = '';
						channel.on('data', (bytes) => {
							input += bytes.toString();
							while (input.includes('\n')) {
								const end = input.indexOf('\n');
								const message = input.slice(0, end);
								input = input.slice(end + 1);
								if (message === 'prompt')
									channel.write(info.command.includes('permission') ? 'approve\n' : 'done\n');
								else {
									assert.equal(message, 'allow_once');
									channel.write('done\n');
								}
							}
						});
						return;
					}
					const child = spawn('sh', ['-c', info.command], { cwd: '/', env: { PATH: process.env.PATH } });
					children.add(child);
					child.on('error', () => {
						channel.exit(127);
						channel.end();
					});
					child.stdout.on('data', (bytes) => channel.write(bytes));
					child.stderr.on('data', (bytes) => channel.stderr.write(bytes));
					child.once('close', (code) => {
						children.delete(child);
						channel.exit(code ?? 1);
						channel.end();
					});
					channel.once('close', () => child.kill('SIGKILL'));
				});
				session.on('sftp', (accept) => {
					state.sftp++;
					state.activeSftp++;
					const sftp = accept();
					sftp.on('error', () => {});
					sftp.on('end', () => sftp.end());
					sftp.once('close', () => state.activeSftp--);
					const handles = new Map();
					let serial = 0;

					const handle = (request, value) => {
						const token = Buffer.from(String(++serial));
						handles.set(token.toString(), value);
						sftp.handle(request, token);
					};

					sftp.on('REALPATH', (request, path) => {
						const respond = () =>
							sftp.name(request, [{ filename: path, longname: path, attrs: attrs(path) }]);

						if (state.holdPaths) {
							state.held.push(respond);
							state.pathEntered.resolve();
						} else respond();
					});
					for (const event of ['STAT', 'LSTAT'])
						sftp.on(event, (request, path) => {
							if (path === '/' || path === '/file.txt') sftp.attrs(request, attrs(path));
							else sftp.status(request, STATUS_CODE.NO_SUCH_FILE);
						});
					sftp.on('OPENDIR', (request) => handle(request, { listed: false }));
					sftp.on('READDIR', (request, token) => {
						const value = handles.get(token.toString());
						if (value.listed) sftp.status(request, STATUS_CODE.EOF);
						else {
							value.listed = true;
							sftp.name(request, [
								{ filename: 'file.txt', longname: 'file.txt', attrs: attrs('/file.txt') },
							]);
						}
					});
					sftp.on('OPEN', (request) => handle(request, {}));
					sftp.on('READ', (request, _token, offset, length) => {
						if (offset >= fileBytes.length) sftp.status(request, STATUS_CODE.EOF);
						else sftp.data(request, fileBytes.subarray(offset, offset + length));
					});
					sftp.on('CLOSE', (request, token) => {
						handles.delete(token.toString());
						sftp.status(request, STATUS_CODE.OK);
					});
				});
			}),
		);
	});
	t.after(async () => {
		await Promise.allSettled(owned.map((resource) => resource.close()));
		for (const child of children) child.kill('SIGKILL');
		for (const peer of peers) peer.end();
		await new Promise((resolve) => server.close(resolve));
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const port = server.address().port;
	let trusts = [{ host: '127.0.0.1', port, fingerprint: hostFingerprint }];
	let currentFingerprint = targetFingerprint;
	const native = new Ssh2MachineFactory();
	const raw = new RemoteMachineModel(
		{
			resolveStored: async (request) => {
				if (request.expectedFingerprint !== undefined && request.expectedFingerprint !== currentFingerprint)
					throw new TargetOperationError('conflict');
				return {
					id: 1,
					fingerprint: currentFingerprint,
					host: '127.0.0.1',
					port,
					username: 'fixture',
					authentication: { kind: 'password', password: 'fixture' },
					jumps: [],
					proxy: null,
				};
			},
		},
		{
			connect: async (endpoint, options) => {
				const machine = await native.connect(endpoint, options);
				nativeMachines.add(machine);
				return machine;
			},
		},
		null,
		{ list: async () => trusts },
	);

	const create = (docker = null) => {
		const pool = new RemoteMachineScopeModel(raw);
		const files = new RemoteFileModel(pool, null, null, null, null, null, null);
		const commands = new PosixCommandAdapter();
		const observations = new ObservationModel(
			pool,
			{
				collect: async (execute) => {
					await execute('printf diagnostic', { timeoutMs: 5000, maxOutputBytes: 100 });
					return { timestamp: Date.now() };
				},

				clear() {},
			},
			docker,
			null,
			null,
		);
		const service = new RemoteMachineOperationService(
			files,
			observations,
			new MachineCommandModel(pool, commands),
			{ run: async (_id, _origin, _targets, work) => work() },
			pool,
		);
		owned.push(service);
		return service;
	};

	return {
		state,
		peers,
		nativeMachines,
		create,
		raw,
		owned,

		changeTarget: (next) => {
			currentFingerprint = next;
		},

		changeTrust: (next) => {
			trusts = next;
		},
	};
}

/** Remote owns only byte channels; official MCP/ACP SDK behavior is covered by signed-plugin HTTP scenarios. */
async function interactiveProcess(service, owner, input) {
	await service.withProcess(owner, { argv: input.argv, cwd: input.cwd, maxReadBytes: 4096 }, async (channel) => {
		let buffered = '';

		async function line() {
			while (!buffered.includes('\n')) {
				const chunk = await channel.read('stdout', 128);
				assert.equal(chunk.eof, false, 'Interactive peer remains open until the owner closes it');
				buffered += Buffer.from(chunk.bytes).toString();
			}
			const end = buffered.indexOf('\n');
			const value = buffered.slice(0, end);
			buffered = buffered.slice(end + 1);
			return value;
		}

		await channel.write(Buffer.from('prompt\n'));
		let reply = await line();
		if (reply === 'approve') {
			const approval = await input.permission();
			assert.equal(approval.decision, 'allow_once');
			await channel.write(Buffer.from(approval.decision + '\n'));
			await approval.delivered();
			reply = await line();
		}
		assert.equal(reply, 'done');
	});
}

await test('Agent reuse: commands, files, diagnostics and interactive processes retain only their Run resources', async (t) => {
	const f = await fixture(t);
	const service = f.create();
	assert.equal(
		(await service.executeCommand(scope(), command('export NEXUS_REUSE_TEST=private; cd /tmp; pwd'))).commands[0]
			.stdout,
		'/tmp\n',
	);
	assert.equal(
		(await service.executeCommand(scope(), command('printf "%s|%s" "$PWD" "${NEXUS_REUSE_TEST-unset}"')))
			.commands[0].stdout,
		'/|unset',
	);
	assert.equal(f.state.connections, 1, 'sequential execs reuse a transport without sharing cwd/env');
	assert.equal((await service.list(scope(), '/'))[0].name, 'file.txt');
	assert.equal((await service.readText(scope(), '/file.txt')).text, fileBytes.toString());
	assert.equal(f.state.connections, 1, 'files borrow the idle command transport');
	assert.equal(f.state.sftp, 1, 'sequential file operations reuse their SFTP channel');
	await service.executeCommand(scope(), command('printf independent'));
	await service.diagnose(scope());
	await interactiveProcess(service, scope(), {
		argv: ['__nexus_interactive__'],
		cwd: '/',
		prompt: 'run',

		permission: () => assert.fail('No permission callback expected'),
	});
	await interactiveProcess(service, scope(), {
		argv: ['__nexus_interactive__'],
		cwd: '/',
		prompt: 'run again',

		permission: () => assert.fail('No permission callback expected'),
	});
	assert.equal(f.state.processes, 2, 'each interactive call starts its own process');
	assert.equal(f.state.connections, 2, 'idle command transport is reused independently of retained SFTP');
	const second = f.create();
	await second.executeCommand(scope(), command('printf another-run'));
	assert.equal(f.state.connections, 3, 'a second Run cannot borrow the first Run transport');
	await service.close();
	await second.close();
});

await test('Agent reuse: concurrent commands isolate their transports and cancellation leaves other channels alive', async (t) => {
	const f = await fixture(t);
	const service = f.create();
	const cancel = new AbortController();
	const pending = service.executeCommand(scope(cancel.signal), command('printf __nexus_hold__'));
	const rejected = assert.rejects(
		pending,
		(error) => error instanceof RemoteFileFailure && error.code === 'operation_unknown',
	);
	await f.state.execEntered.promise;
	assert.equal((await service.executeCommand(scope(), command('printf healthy'))).commands[0].stdout, 'healthy');
	assert.equal(f.state.connections, 2);
	cancel.abort();
	await rejected;
	assert.equal(
		(await service.executeCommand(scope(), command('printf still-healthy'))).commands[0].stdout,
		'still-healthy',
	);
	assert.equal(f.state.connections, 2, 'a retired connection can be replaced after its last lease');
});

await test('Agent reuse: interactive process callbacks complete while a large exec remains active on its own transport', async (t) => {
	const f = await fixture(t),
		service = f.create(),
		stop = new AbortController();
	const blocked = Promise.withResolvers();
	let outputCalls = 0;
	const request = command('printf __nexus_hold__ __nexus_bulk__');
	request.onOutput = async (_index, _stream, _text, signal) => {
		outputCalls++;
		blocked.resolve();
		if (!signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
	};
	const bulk = assert.rejects(
		service.executeCommand(scope(stop.signal), request),
		(error) => error instanceof RemoteFileFailure && error.code === 'operation_unknown',
	);
	await f.state.execEntered.promise;
	await blocked.promise;
	let approval = false;
	await interactiveProcess(service, scope(), {
		argv: ['__nexus_interactive__', 'permission'],
		cwd: '/',
		prompt: 'interactive approval',

		permission: async () => {
			approval = true;
			return {
				decision: 'allow_once',

				delivered: async () => {},
			};
		},
	});
	assert.equal(approval, true);
	assert.equal(f.state.connections, 2, 'background output and an interactive process cannot share TCP backpressure');
	assert.equal(outputCalls, 1, 'a blocked output sink never accumulates append requests');
	stop.abort();
	await bulk;
	assert.equal((await service.executeCommand(scope(), command('printf healthy'))).commands[0].stdout, 'healthy');
});

await test('Agent reuse: concurrent file operations own separate SFTP channels and reconnect before dispatch', async (t) => {
	const f = await fixture(t);
	const service = f.create();
	f.state.holdPaths = true;
	const cancel = new AbortController();
	const first = assert.rejects(service.list(scope(cancel.signal), '/'));
	await f.state.pathEntered.promise;
	f.state.holdPaths = false;
	assert.equal((await service.list(scope(), '/'))[0].name, 'file.txt');
	assert.equal(f.state.sftp, 2);
	assert.equal(f.state.connections, 2);
	cancel.abort();
	await first;
	assert.equal((await service.readText(scope(), '/file.txt')).text, fileBytes.toString());
	assert.equal(f.state.sftp, 2, 'cancelling one SFTP operation does not close another');
	const closed = [...f.nativeMachines]
		.filter((machine) => machine.isOpen)
		.map((machine) => new Promise((resolve) => machine.onClose(resolve)));
	for (const peer of f.peers) peer.end();
	await Promise.all(closed);
	assert.equal((await service.list(scope(), '/'))[0].name, 'file.txt');
	assert.equal(f.state.sftp, 3);
	assert.equal(f.state.connections, 3, 'a dead idle resource is replaced before work begins');
});

await test('Agent reuse: authorization and host trust are checked before reusing an idle transport', async (t) => {
	const f = await fixture(t);
	const service = f.create();
	await service.executeCommand(scope(), command('printf initial'));
	const before = f.state.exec;
	await assert.rejects(
		service.executeCommand(
			scope(undefined, async () => {
				throw new RemoteFileFailure('forbidden');
			}),
			command('printf forbidden'),
		),
	);
	assert.equal(f.state.exec, before);
	const next = 'b'.repeat(64);
	f.changeTarget(next);
	await assert.rejects(service.executeCommand(scope(), command('printf stale-target')));
	assert.equal(f.state.exec, before);
	await service.executeCommand({ ...scope(), fingerprint: next }, command('printf new-target'));
	assert.equal(f.state.connections, 2, 'new target credentials cannot reuse the prior connection');
	f.changeTrust([]);
	await assert.rejects(service.executeCommand({ ...scope(), fingerprint: next }, command('printf untrusted')));
	assert.equal(f.state.exec, before + 1, 'revoked host trust cannot reuse the old authenticated connection');
});

await test('Agent reuse: Agent Run drain releases the Remote factory and late captured work stays closed', async (t) => {
	const f = await fixture(t);
	let created = 0;
	const factory = new RemoteMachineOperationFactoryService(() => {
		created++;
		return f.create();
	});
	const model = new ToolModel(null, null, remoteOperationFactory(factory), null);
	const remote = model.remote({ userId: 1, appId: 'app', runId: 'run-a' });
	assert.strictEqual(model.remote({ userId: 1, appId: 'app', runId: 'run-a' }), remote);
	const target = { id: 1, version: 1, fingerprint: targetFingerprint };
	const input = { kind: 'shell', commands: ['printf run-owned'], cwd: null, onError: 'stop', mode: 'foreground' };
	const request = {
		operationId: randomUUID(),
		target,
		timeoutMs: 10000,
		signal: new AbortController().signal,

		validate: async () => {},
	};
	await remote.command(input, request);
	const listing = await remote.listPage({ path: '/', after: '' }, request);
	assert.equal(listing.status, 'ok');
	assert.equal(listing.value.entries[0].name, 'file.txt');
	const instruction = await remote.readTextPage(
		{ path: '/file.txt', offset: 0, maxBytes: fileBytes.length },
		request,
	);
	assert.equal(instruction.status, 'ok');
	assert.equal(instruction.value.text, fileBytes.toString());
	const delivered = await remote.consumeFile('/file.txt', fileBytes.length, request, async (_file, source) => {
		const chunks = [];
		for await (const chunk of source) chunks.push(chunk);
		return Buffer.concat(chunks);
	});
	assert.deepEqual(delivered, fileBytes);
	assert.equal(f.state.sftp, 1, 'project guidance and file delivery share the Run file resource');
	await model.drainRun('run-a');
	await assert.rejects(remote.command(input, request));
	assert.equal(created, 1, 'late work uses its captured closed capability');
	assert.equal(f.state.connections, 1);
	await factory.close();
	assert.throws(() => factory.create());
});

await test('Agent reuse: Docker inspection and control reuse the Run command transport', async (t) => {
	const f = await fixture(t);
	const id = '1'.repeat(64);
	let current = 'running';
	const service = f.create({
		inspect: async (execute) => {
			await execute('printf docker-inspect', { timeoutMs: 5000, maxOutputBytes: 100 });
			return { id, state: current, image: 'fixture:latest', created: '1' };
		},

		status: async (execute) => {
			await execute('printf docker-status', { timeoutMs: 5000, maxOutputBytes: 100 });
			return {
				available: true,
				containers: [
					{
						id,
						names: ['fixture'],
						image: 'fixture:latest',
						imageId: 'fixture',
						command: 'fixture',
						created: 1,
						state: current,
						status: current,
						ports: [],
						labels: {},
						stats: null,
					},
				],
			};
		},

		command: async (execute) => {
			await execute('printf docker-stop', { timeoutMs: 5000, maxOutputBytes: 100 });
			current = 'exited';
		},
	});
	await service.executeCommand(scope(), command('printf initial'));
	const inspected = await service.inspectDocker(scope(), id);
	assert.equal(
		(
			await service.controlDocker(scope(), {
				containerId: id,
				action: 'stop',
				expectedFingerprint: inspected.fingerprint,
			})
		).state,
		'exited',
	);
	assert.equal(f.state.connections, 1);
});
