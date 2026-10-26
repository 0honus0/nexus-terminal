import { createServer, connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, trustTestSshHostKey } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import { readTestConnectionImportId } from '../../support/targets';
import {
	closeWebSocket,
	openWorkspaceSession,
	requestWorkspace,
	waitForFilesystemReady,
	waitForJson,
} from '../../support/ws';
import { readServerTransferSnapshot } from '../../../../packages/shared/src/remote/transfers/server-codec';

async function target(request: APIRequestContext, port: number): Promise<number> {
	await trustTestSshHostKey(request, port);
	const response = await request.post('/api/v1/targets/connections/import', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: {
			items: [
				{
					connection: {
						name: `Transfer peer ${port}`,
						type: 'SSH',
						host: E2E_SSH.host,
						port,
						username: E2E_SSH.username,
						notes: null,
						route: 'direct',
						proxyId: null,
						tagIds: [],
						jumpIds: [],
					},
					credential: { kind: 'password', password: E2E_SSH.password },
				},
			],
		},
	});
	expect(response.status()).toBe(200);
	return readTestConnectionImportId(await response.json());
}

for (const entrypoint of ['clipboard', 'send'] as const) {
	for (const blocked of [false, true]) {
		test(`${entrypoint}: ${blocked ? 'isolated peers relay' : 'reachable peers transfer directly'} with live single-file progress and exact bytes`, async ({
			request,
		}, testInfo) => {
			test.setTimeout(90_000);
			await loginAsInitialAdmin(request);
			// A second TCP endpoint reaches the same real SSH fixture. Distinct
			// source/destination paths let native rsync transfer actual bytes.
			const sockets = new Set<Socket>();
			const proxy = createServer((client) => {
				const upstream = connect(E2E_SSH.port, E2E_SSH.host);
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
			proxy.listen(0, E2E_SSH.host);
			await once(proxy, 'listening');
			const address = proxy.address();
			if (!address || typeof address === 'string') throw new Error('Missing transfer proxy port');
			const workspaces: Awaited<ReturnType<typeof openWorkspaceSession>>[] = [];
			try {
				const sourceId = await target(request, E2E_SSH.port);
				const targetId = await target(request, address.port);
				const health = await (await fetch(`${E2E_SSH.controlUrl}/health`)).json();
				const root = String(health.rootDir);
				const sourcePath = path.join(root, 'single-package.zip');
				const destination = path.join(root, 'peer-output');
				const bytes = Buffer.alloc(8 * 1024 * 1024);
				for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
				await writeFile(sourcePath, bytes);
				expect(
					(
						await fetch(`${E2E_SSH.controlUrl}/transfer-peer?blocked=${blocked ? 1 : 0}&bandwidth=1024`, {
							method: 'POST',
						})
					).ok,
				).toBe(true);
				expect(
					(await fetch(`${E2E_SSH.controlUrl}/sftp/read-network?ms=${blocked ? 20 : 0}`, { method: 'POST' }))
						.ok,
				).toBe(true);
				const start = performance.now();
				if (entrypoint === 'clipboard') {
					const source = await openWorkspaceSession(request, sourceId);
					const destinationSession = await openWorkspaceSession(request, targetId);
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
						headers: { Origin: E2E_URLS.frontendOrigin },
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
									expect(next.subTasks[0]?.transferMethodUsed).toBe(blocked ? 'sftp' : 'rsync');
								return next.status;
							},
							{ timeout: 45_000, intervals: [100] },
						)
						.toBe('completed');
					expect(observedLive).toBe(true);
				}
				const elapsedMs = performance.now() - start;
				const actual = await readFile(path.join(destination, path.basename(sourcePath)));
				expect(createHash('sha256').update(actual).digest('hex')).toBe(
					createHash('sha256').update(bytes).digest('hex'),
				);
				const peer = await (await fetch(`${E2E_SSH.controlUrl}/transfer-peer`)).json();
				const reads = await (await fetch(`${E2E_SSH.controlUrl}/sftp/read-network`)).json();
				expect(peer.transferPeerProbes).toBe(1);
				expect(peer.nativeTransfersStarted).toBe(blocked ? 0 : 1);
				expect(peer.nativeTransfersExited).toBe(blocked ? 0 : 1);
				expect(reads.sftpReadResponseBytes).toBe(blocked ? bytes.length : 0);
				expect(reads.sftpReadPending).toBe(0);
				await testInfo.attach('transfer-route-evidence', {
					body: JSON.stringify({ entrypoint, blocked, elapsedMs, bytes: bytes.length, peer, reads }),
					contentType: 'application/json',
				});
			} finally {
				await Promise.allSettled(workspaces.map((workspace) => closeWebSocket(workspace.socket)));
				for (const socket of sockets) socket.destroy();
				await new Promise<void>((resolve) => proxy.close(() => resolve()));
				await fetch(`${E2E_SSH.controlUrl}/transfer-peer`, { method: 'POST' });
			}
		});
	}
}

for (const outcome of ['failed', 'cancelled'] as const) {
	test(`a ${outcome} native transfer keeps the source and never starts a relay`, async ({ request }) => {
		test.setTimeout(90_000);
		await loginAsInitialAdmin(request);
		const sourceId = await target(request, E2E_SSH.port);
		const targetId = await target(request, E2E_SSH.port);
		const health = await (await fetch(`${E2E_SSH.controlUrl}/health`)).json();
		const root = String(health.rootDir);
		const sourcePath = path.join(root, 'native-interrupted.zip');
		const bytes = Buffer.alloc(8 * 1024 * 1024, 0x4d);
		await writeFile(sourcePath, bytes);
		expect(
			(
				await fetch(`${E2E_SSH.controlUrl}/transfer-peer?fail=${outcome === 'failed' ? 1 : 0}&bandwidth=512`, {
					method: 'POST',
				})
			).ok,
		).toBe(true);
		const source = await openWorkspaceSession(request, sourceId);
		const destination = await openWorkspaceSession(request, targetId);
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
				.poll(
					async () =>
						(await (await fetch(`${E2E_SSH.controlUrl}/transfer-peer`)).json()).nativeTransfersExited,
				)
				.toBe(1);
			const reads = await (await fetch(`${E2E_SSH.controlUrl}/sftp/read-network`)).json();
			expect(reads.sftpReadResponseBytes).toBe(0);
		} finally {
			await Promise.allSettled([closeWebSocket(source.socket), closeWebSocket(destination.socket)]);
			await fetch(`${E2E_SSH.controlUrl}/transfer-peer`, { method: 'POST' });
		}
	});
}
