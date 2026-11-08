import { createServer, connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, symlink, lstat, readlink, stat, utimes, readdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, HTTP_TEST_ORIGIN } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { loginAsAdmin } from '../../../../support/http/ssh-protocol-fixture.mjs';
import {
	closeWebSocket,
	openWorkspaceSession,
	requestWorkspace,
	waitForFilesystemReady,
	waitForJson,
} from '../../../../support/protocols/workspace-client';
import { readServerTransferSnapshot } from '../../../../../packages/shared/src/remote/transfers/server-codec';

import type { APIRequestContext } from '@playwright/test';
import type { ControlledSsh } from '../../../../support/protocols/controlled-ssh-fixture.mjs';
import { trustSshHostKey } from '../../../../support/http/ssh-targets.ts';
import { readTestConnectionImportId } from '../../../../support/http/target-import';

async function target(request: APIRequestContext, ssh: ControlledSsh, port: number): Promise<number> {
	await trustSshHostKey(request, ssh, port);
	const response = await request.post('/api/v1/targets/connections/import', {
		data: {
			items: [
				{
					connection: {
						name: `Transfer peer ${port}`,
						type: 'SSH',
						host: ssh.host,
						port,
						username: ssh.username,
						notes: null,
						route: 'direct',
						proxyId: null,
						tagIds: [],
						jumpIds: [],
					},
					credential: { kind: 'password', password: ssh.password },
				},
			],
		},
	});
	expect(response.status()).toBe(200);
	return readTestConnectionImportId(await response.json());
}

for (const entrypoint of ['clipboard', 'send'] as const) {
	for (const route of ['rsync', 'scp', 'relay'] as const) {
		const blocked = route === 'relay';
		test(`${entrypoint}: ${route} route has live single-file progress and exact bytes`, async ({
			request,
			ssh,
			httpClients,
		}) => {
			await loginAsAdmin(request);
			// A second TCP endpoint reaches the same real SSH fixture. Distinct
			// source/destination paths let native rsync transfer actual bytes.
			// A 3 MiB/s native rate leaves multiple one-second progress samples without spending
			// eight seconds on every successful 8 MiB transfer. Dedicated weak-network
			// profiles and cancellation stalls keep their original rates.
			const sockets = new Set<Socket>();
			const proxy = createServer((client) => {
				const upstream = connect(ssh.port, ssh.host);
				for (const socket of [client, upstream]) {
					sockets.add(socket);
					socket.on('close', () => sockets.delete(socket));
					socket.on('error', () => {
						client.destroy();
						upstream.destroy();
					});
				}
				client.pipe(upstream).pipe(client);
			});
			proxy.listen(0, ssh.host);
			await once(proxy, 'listening');
			const address = proxy.address();
			if (!address || typeof address === 'string') throw new Error('Missing transfer proxy port');
			const workspaces: Awaited<ReturnType<typeof openWorkspaceSession>>[] = [];
			try {
				const sourceId = await target(request, ssh, ssh.port);
				const targetId = await target(request, ssh, address.port);
				const health = await (await fetch(`${ssh.controlUrl}/health`)).json();
				const root = String(health.rootDir);
				const sourcePath = path.join(root, 'single-package.zip');
				const destination = path.join(root, 'peer-output');
				const bytes = Buffer.alloc(8 * 1024 * 1024);
				for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
				await writeFile(sourcePath, bytes);
				// Equal size/mtime must not let rsync's quick check retain stale bytes.
				await mkdir(destination);
				const destinationPath = path.join(destination, path.basename(sourcePath));
				await writeFile(destinationPath, Buffer.alloc(bytes.length, 0xff));
				const timestamp = new Date('2026-01-01T00:00:00Z');
				await Promise.all([sourcePath, destinationPath].map((file) => utimes(file, timestamp, timestamp)));
				expect((await stat(destinationPath)).mtimeMs).toBe((await stat(sourcePath)).mtimeMs);
				expect(
					(
						await fetch(`${ssh.controlUrl}/transfer-peer?blocked=${blocked ? 1 : 0}&bandwidth=3072`, {
							method: 'POST',
						})
					).ok,
				).toBe(true);
				expect(
					(await fetch(`${ssh.controlUrl}/sftp/read-network?ms=${blocked ? 20 : 0}`, { method: 'POST' })).ok,
				).toBe(true);
				expect(
					(
						await fetch(`${ssh.controlUrl}/remote-tools?missing=${route === 'scp' ? 'rsync' : ''}`, {
							method: 'POST',
						})
					).ok,
				).toBe(true);
				const start = performance.now();
				if (entrypoint === 'clipboard') {
					const source = await httpClients.openWorkspace(sourceId);
					const destinationSession = await httpClients.openWorkspace(targetId);
					workspaces.push(source, destinationSession);
					await Promise.all(workspaces.map((workspace) => waitForFilesystemReady(workspace.socket)));
					const id = crypto.randomUUID();
					const live = waitForJson(
						destinationSession.socket,
						(event) =>
							event.type === 'transfer.copyMove' &&
							event.payload?.requestId === id &&
							event.payload?.type === 'progress' &&
							event.payload.transferredBytes > 0 &&
							event.payload.transferredBytes < bytes.length,
						30_000,
					);
					const terminal = waitForJson(
						destinationSession.socket,
						(event) =>
							event.type === 'transfer.copyMove' &&
							event.payload?.requestId === id &&
							['completed', 'failed'].includes(String(event.payload?.type)),
						45_000,
					);
					void live.catch(() => undefined);
					void terminal.catch(() => undefined);
					await requestWorkspace(
						destinationSession.socket,
						'transfer.copyMove',
						{ mode: 'copy', sourceWorkspaceId: source.workspaceId, sources: [sourcePath], destination },
						id,
					);
					expect((await live).payload).toMatchObject({
						totalKnown: true,
						totalBytes: bytes.length,
						totalFiles: 1,
					});
					expect((await terminal).payload?.type).toBe('completed');
				} else {
					const sent = await request.post('/api/v1/transfers/send', {
						headers: { Origin: HTTP_TEST_ORIGIN },
						data: {
							sourceConnectionId: sourceId,
							connectionIds: [targetId],
							sourceItems: [{ name: path.basename(sourcePath), path: sourcePath, type: 'file' }],
							remoteTargetPath: destination,
							transferMethod: 'auto',
						},
					});
					expect(sent.status()).toBe(202);
					const task = readServerTransferSnapshot(await sent.json());
					let observedLive = false;
					await expect
						.poll(
							async () => {
								const response = await request.get(`/api/v1/transfers/status/${task.taskId}`);
								expect(response.status()).toBe(200);
								const next = readServerTransferSnapshot(await response.json());
								observedLive ||= next.overallProgress > 0 && next.overallProgress < 100;
								expect(['failed', 'unknown', 'partially-completed']).not.toContain(next.status);
								if (next.status === 'completed')
									expect(next.subTasks[0]?.transferMethodUsed).toBe(blocked ? 'sftp' : route);
								return next.status;
							},
							{ timeout: 45_000, interval: 100 },
						)
						.toBe('completed');
					expect(observedLive).toBe(true);
				}
				const elapsedMs = performance.now() - start;
				const actual = await readFile(path.join(destination, path.basename(sourcePath)));
				expect(createHash('sha256').update(actual).digest('hex')).toBe(
					createHash('sha256').update(bytes).digest('hex'),
				);
				const peer = await (await fetch(`${ssh.controlUrl}/transfer-peer`)).json();
				const reads = await (await fetch(`${ssh.controlUrl}/sftp/read-network`)).json();
				expect(peer.transferPeerProbes).toBe(1);
				expect(peer.nativeTransfersStarted).toBe(blocked ? 0 : 1);
				expect(peer.nativeTransfersExited).toBe(blocked ? 0 : 1);
				expect(reads.sftpReadResponseBytes).toBe(blocked ? bytes.length : 0);
				expect(reads.sftpReadPending).toBe(0);
				await writeFile(
					path.join(ssh.directory, 'transfer-route-evidence.json'),
					JSON.stringify({ entrypoint, blocked, elapsedMs, bytes: bytes.length, peer, reads }),
				);
			} finally {
				await Promise.allSettled(workspaces.map((workspace) => closeWebSocket(workspace.socket)));
				for (const socket of sockets) socket.destroy();
				await new Promise<void>((resolve) => proxy.close(() => resolve()));
				await fetch(`${ssh.controlUrl}/transfer-peer`, { method: 'POST' });
			}
		});
	}
}

for (const mode of ['copy', 'move'] as const) {
	test(`duplicate connections reject ${mode} onto the source through canonical directory aliases`, async ({
		request,
		ssh,
		httpClients,
	}) => {
		await loginAsAdmin(request);
		const sourceId = await target(request, ssh, ssh.port);
		const destinationId = await target(request, ssh, ssh.port);
		const health = await (await fetch(`${ssh.controlUrl}/health`)).json();
		const root = String(health.rootDir);
		const directory = path.join(root, 'overlap-source');
		const alias = path.join(root, 'overlap-alias');
		await mkdir(directory);
		const sourcePath = path.join(directory, 'data.txt');
		const bytes = Buffer.from('must survive a rejected overlapping transfer');
		await writeFile(sourcePath, bytes);
		await symlink(directory, alias);
		const source = await httpClients.openWorkspace(sourceId);
		const destination = await httpClients.openWorkspace(destinationId);
		try {
			await Promise.all([waitForFilesystemReady(source.socket), waitForFilesystemReady(destination.socket)]);
			for (const paths of [
				{ sourcePath, targetDirectory: directory },
				{ sourcePath: path.join(alias, 'data.txt'), targetDirectory: directory },
				{ sourcePath: directory, targetDirectory: path.join(directory, 'new', 'nested') },
			]) {
				const id = crypto.randomUUID();
				const ended = waitForJson(
					destination.socket,
					(event) =>
						event.type === 'transfer.copyMove' &&
						event.payload?.requestId === id &&
						['completed', 'failed'].includes(String(event.payload?.type)),
				);
				void ended.catch(() => undefined);
				await requestWorkspace(
					destination.socket,
					'transfer.copyMove',
					{
						mode,
						sourceWorkspaceId: source.workspaceId,
						sources: [paths.sourcePath],
						destination: paths.targetDirectory,
					},
					id,
				);
				expect((await ended).payload).toMatchObject({ type: 'failed', message: 'conflict' });
				expect(await readFile(sourcePath)).toEqual(bytes);
				expect(await readdir(directory)).toEqual(['data.txt']);
			}
			const peer = await (await fetch(`${ssh.controlUrl}/transfer-peer`)).json();
			expect(peer.nativeTransfersStarted).toBe(0);
			// The original same-connection, same-path move remains a harmless no-op.
			if (mode === 'move') {
				const id = crypto.randomUUID();
				const ended = waitForJson(
					source.socket,
					(event) =>
						event.type === 'transfer.copyMove' &&
						event.payload?.requestId === id &&
						['completed', 'failed'].includes(String(event.payload?.type)),
				);
				void ended.catch(() => undefined);
				await requestWorkspace(
					source.socket,
					'transfer.copyMove',
					{
						mode,
						sourceWorkspaceId: source.workspaceId,
						sources: [sourcePath],
						destination: directory,
					},
					id,
				);
				expect((await ended).payload?.type).toBe('completed');
				expect(await readFile(sourcePath)).toEqual(bytes);
			}
		} finally {
			await Promise.allSettled([closeWebSocket(source.socket), closeWebSocket(destination.socket)]);
		}
	});
}

test('rsync move replaces stale equal-size equal-mtime bytes before removing the source', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const sourceId = await target(request, ssh, ssh.port);
	const destinationId = await target(request, ssh, ssh.port);
	const health = await (await fetch(`${ssh.controlUrl}/health`)).json();
	const root = String(health.rootDir);
	const sourcePath = path.join(root, 'move-overwrite.bin');
	const targetDirectory = path.join(root, 'move-overwrite-target');
	const destinationPath = path.join(targetDirectory, path.basename(sourcePath));
	const bytes = Buffer.alloc(64 * 1024, 0x35);
	await mkdir(targetDirectory);
	await writeFile(sourcePath, bytes);
	await writeFile(destinationPath, Buffer.alloc(bytes.length, 0x79));
	const timestamp = new Date('2026-01-01T00:00:00Z');
	await Promise.all([sourcePath, destinationPath].map((file) => utimes(file, timestamp, timestamp)));
	const source = await httpClients.openWorkspace(sourceId);
	const destination = await httpClients.openWorkspace(destinationId);
	try {
		await Promise.all([waitForFilesystemReady(source.socket), waitForFilesystemReady(destination.socket)]);
		const id = crypto.randomUUID();
		const ended = waitForJson(
			destination.socket,
			(event) =>
				event.type === 'transfer.copyMove' &&
				event.payload?.requestId === id &&
				['completed', 'failed'].includes(String(event.payload?.type)),
		);
		void ended.catch(() => undefined);
		await requestWorkspace(
			destination.socket,
			'transfer.copyMove',
			{
				mode: 'move',
				sourceWorkspaceId: source.workspaceId,
				sources: [sourcePath],
				destination: targetDirectory,
			},
			id,
		);
		expect((await ended).payload?.type).toBe('completed');
		expect(await readFile(destinationPath)).toEqual(bytes);
		await expect(stat(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' });
		const peer = await (await fetch(`${ssh.controlUrl}/transfer-peer`)).json();
		expect(peer.nativeTransfersStarted).toBe(1);
		expect(peer.nativeTransfersExited).toBe(1);
	} finally {
		await Promise.allSettled([closeWebSocket(source.socket), closeWebSocket(destination.socket)]);
	}
});

for (const outcome of ['failed', 'cancelled'] as const) {
	test(`a ${outcome} native transfer keeps the source and never starts a relay`, async ({
		request,
		ssh,
		httpClients,
	}) => {
		await loginAsAdmin(request);
		const sourceId = await target(request, ssh, ssh.port);
		const targetId = await target(request, ssh, ssh.port);
		const health = await (await fetch(`${ssh.controlUrl}/health`)).json();
		const root = String(health.rootDir);
		const sourcePath = path.join(root, 'native-interrupted.zip');
		const bytes = Buffer.alloc(8 * 1024 * 1024, 0x4d);
		await writeFile(sourcePath, bytes);
		expect(
			(
				await fetch(`${ssh.controlUrl}/transfer-peer?fail=${outcome === 'failed' ? 1 : 0}&bandwidth=512`, {
					method: 'POST',
				})
			).ok,
		).toBe(true);
		const source = await httpClients.openWorkspace(sourceId);
		const destination = await httpClients.openWorkspace(targetId);
		try {
			await Promise.all([waitForFilesystemReady(source.socket), waitForFilesystemReady(destination.socket)]);
			const id = crypto.randomUUID();
			const terminal = waitForJson(
				destination.socket,
				(event) =>
					event.type === 'transfer.copyMove' &&
					event.payload?.requestId === id &&
					['completed', 'failed', 'cancelled'].includes(String(event.payload?.type)),
				45_000,
			);
			void terminal.catch(() => undefined);
			const live =
				outcome === 'cancelled'
					? waitForJson(
							destination.socket,
							(event) =>
								event.type === 'transfer.copyMove' &&
								event.payload?.requestId === id &&
								event.payload?.type === 'progress' &&
								event.payload.transferredBytes > 0 &&
								event.payload.transferredBytes < bytes.length,
							30_000,
						)
					: null;
			void live?.catch(() => undefined);
			await requestWorkspace(
				destination.socket,
				'transfer.copyMove',
				{
					mode: 'move',
					sourceWorkspaceId: source.workspaceId,
					sources: [sourcePath],
					destination: path.join(root, 'interrupted-target'),
				},
				id,
			);
			if (live) {
				await live;
				await requestWorkspace(destination.socket, 'transfer.cancel', { taskId: id });
			}
			expect((await terminal).payload).toMatchObject({ type: 'failed', message: 'operation_unknown' });
			expect(await readFile(sourcePath)).toEqual(bytes);
			await expect
				.poll(async () => (await (await fetch(`${ssh.controlUrl}/transfer-peer`)).json()).nativeTransfersExited)
				.toBe(1);
			const reads = await (await fetch(`${ssh.controlUrl}/sftp/read-network`)).json();
			expect(reads.sftpReadResponseBytes).toBe(0);
		} finally {
			await Promise.allSettled([closeWebSocket(source.socket), closeWebSocket(destination.socket)]);
			await fetch(`${ssh.controlUrl}/transfer-peer`, { method: 'POST' });
		}
	});
}

test('auto directory fallback preserves nested and root symlinks when rsync is unavailable', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const sourceId = await target(request, ssh, ssh.port);
	const destinationId = await target(request, ssh, ssh.transferTargetPort);
	const health = await (await fetch(`${ssh.controlUrl}/health`)).json();
	const root = String(health.rootDir);
	await mkdir(path.join(root, 'tool-directory'));
	await writeFile(path.join(root, 'tool-directory', 'data.txt'), 'link-preserving-copy\n');
	await symlink('data.txt', path.join(root, 'tool-directory', 'nested-link.txt'));
	await symlink('tool-directory/data.txt', path.join(root, 'root-link.txt'));
	expect((await fetch(`${ssh.controlUrl}/remote-tools?missing=rsync`, { method: 'POST' })).ok).toBe(true);
	const source = await httpClients.openWorkspace(sourceId);
	const destination = await httpClients.openWorkspace(destinationId);
	try {
		await Promise.all([waitForFilesystemReady(source.socket), waitForFilesystemReady(destination.socket)]);
		const id = crypto.randomUUID();
		const ended = waitForJson(
			destination.socket,
			(message) =>
				message.type === 'transfer.copyMove' &&
				message.payload?.requestId === id &&
				['completed', 'failed'].includes(message.payload?.type),
		);
		await requestWorkspace(
			destination.socket,
			'transfer.copyMove',
			{
				mode: 'copy',
				sourceWorkspaceId: source.workspaceId,
				sources: ['/tool-directory', '/root-link.txt'],
				destination: '/folder-seed',
			},
			id,
		);
		expect((await ended).payload?.type).toBe('completed');
		const copied = path.join(root, 'folder-seed');
		expect(await readFile(path.join(copied, 'tool-directory', 'data.txt'), 'utf8')).toBe('link-preserving-copy\n');
		for (const [name, target] of [
			['tool-directory/nested-link.txt', 'data.txt'],
			['root-link.txt', 'tool-directory/data.txt'],
		]) {
			expect((await lstat(path.join(copied, name))).isSymbolicLink()).toBe(true);
			expect(await readlink(path.join(copied, name))).toBe(target);
		}
		expect(await readlink(path.join(root, 'root-link.txt'))).toBe('tool-directory/data.txt');
		const peer = await (await fetch(`${ssh.controlUrl}/transfer-peer`)).json();
		expect(peer.nativeTransfersStarted).toBe(0);
	} finally {
		await Promise.allSettled([closeWebSocket(source.socket), closeWebSocket(destination.socket)]);
		expect((await fetch(`${ssh.controlUrl}/remote-tools`, { method: 'POST' })).ok).toBe(true);
	}
});
