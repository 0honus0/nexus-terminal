import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';
import { RemoteFileFailure } from '../../../packages/backend/dist/modules/remote/files/model/file-types.js';
import { origin, until, send, expectStatus, openSshd, openWorkspace } from './openssh-fixture.mjs';

export async function fileHandles(path) {
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

function knownShutdownFailure(error) {
	if (error instanceof AggregateError) {
		return error.errors.length > 0 && error.errors.every(knownShutdownFailure);
	}
	return error instanceof RemoteFileFailure && ['operation_unknown', 'remote_unavailable'].includes(error.code);
}

export async function remoteFilesFixture(t) {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-file-transfers-'));
	const daemons = [];
	const workspaces = [];
	const state = { allowUnknownShutdown: false, app: null };
	t.after(async () => {
		const failures = [];
		try {
			const sockets = await Promise.allSettled(workspaces.map(({ workspace }) => workspace.close()));
			failures.push(...sockets.filter((result) => result.status === 'rejected').map((result) => result.reason));
			if (state.app) {
				try {
					await state.app.close();
				} catch (error) {
					if (!state.allowUnknownShutdown || !knownShutdownFailure(error)) {
						failures.push(error);
					}
				}
			}
		} finally {
			try {
				const results = await Promise.allSettled(daemons.map((daemon) => daemon.close()));
				failures.push(
					...results.filter((result) => result.status === 'rejected').map((result) => result.reason),
				);
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		}
		if (failures.length) {
			throw new AggregateError(failures, 'Remote transfer fixture cleanup failed');
		}
	});
	const app = await createApp(join(directory, 'state.db'), { encryptionKey: randomBytes(32) });
	state.app = app;
	const address = await app.listenHttp({ publicOrigin: origin, bindHost: '127.0.0.1', port: 0, trustedProxies: [] });
	const password = 'b10-file-transfers-password';
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
	const cookie = login.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');

	async function connect(target) {
		const workspace = await openWorkspace(address, cookie);
		const owner = { workspace, target, connection: null };
		workspaces.push(owner);
		const response = await workspace.call('workspace.connect', {
			workspaceId: randomUUID(),
			connectionId: target.id,
			viewport: { columns: 80, rows: 24 },
		});
		assert.equal(response.ok, true, JSON.stringify(response));
		owner.connection = response.data;
		const event = await until(
			() => workspace.events.find((value) => ['filesystem.ready', 'filesystem.error'].includes(value.type)),
			Boolean,
			'Workspace files readiness',
		);
		assert.equal(event.type, 'filesystem.ready', JSON.stringify(event));
		return owner;
	}

	async function endpoint(name) {
		const root = join(directory, name);
		await mkdir(root);
		const daemon = await openSshd(root);
		daemons.push(daemon);
		await app.targets.hostKeys.confirm({ host: '127.0.0.1', port: daemon.port, fingerprint: daemon.fingerprint });
		const key = await app.targets.sshKeys.create({ name, privateKey: daemon.privateKey });
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
		return { root, ...(await connect(target)) };
	}

	async function close(owner) {
		return owner.workspace.call('workspace.close', {
			workspaceId: owner.connection.workspaceId,
			connectionId: owner.target.id,
			resumeToken: owner.connection.resumeToken,
			attachmentGeneration: owner.connection.attachmentGeneration,
		});
	}

	return { directory, state, app, address, cookie, endpoint, connect, close };
}

export function transferEvent(workspace, channel, requestId, types) {
	return until(
		() =>
			workspace.events.find(
				(event) =>
					event.type === channel &&
					event.payload.requestId === requestId &&
					types.includes(event.payload.type),
			),
		Boolean,
		'Transfer event ' + types.join('/'),
	);
}
