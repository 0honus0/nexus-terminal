import { createServer, connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
	E2E_SSH,
	trustTestSshHostKey,
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	openConnectedFileManager,
	closeConnectedFileManager,
	resetTestSshFilesystem,
} from '../../support/ssh';
import {
	rightClickRow,
	clickMenuItem,
	goIntoFolder,
	openCurrentDirectoryContextMenu,
	visibleProgressTask,
} from './progress-display.helpers';
import { readWorkspaceMessage } from '../../../../packages/shared/src/remote/workspace/workspace-codec';
import { readWorkspaceCopyMoveEvent } from '../../../../packages/shared/src/remote/transfers/task-codec';
import type { WorkspaceCopyMoveEvent } from '../../../../packages/shared/src/remote/transfers/workspace';
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

for (const blocked of [false, true]) {
	test(`clipboard UI: ${blocked ? 'relayed' : 'direct'} cross-server paste displays live byte progress and completes the exact file`, async ({
		page,
		context,
	}, testInfo) => {
		const request = context.request;
		test.setTimeout(90_000);
		await loginAsInitialAdmin(request);
		await configureSshE2eSettings(request);
		await resetTestSshFilesystem();
		const sourceId = await target(request, E2E_SSH.port);
		const destinationId = await target(request, E2E_SSH.transferTargetPort);
		const health = await (await fetch(`${E2E_SSH.controlUrl}/health`)).json();
		const root = String(health.rootDir);
		const filename = 'clipboard-progress-package.zip';
		const bytes = Buffer.alloc(8 * 1024 * 1024, 0x5a);
		await writeFile(path.join(root, filename), bytes);
		const taskEvents: WorkspaceCopyMoveEvent[] = [];
		const protocolErrors: string[] = [];
		page.on('websocket', (socket) => {
			if (new URL(socket.url()).pathname !== '/ws/workspace') return;
			socket.on('framereceived', ({ payload }) => {
				if (typeof payload !== 'string') return;
				try {
					const message = readWorkspaceMessage(JSON.parse(payload));
					if (message.type === 'transfer.copyMove' && !('requestId' in message)) {
						taskEvents.push(readWorkspaceCopyMoveEvent(message.payload));
					}
				} catch (cause) {
					protocolErrors.push(cause instanceof Error ? cause.message : String(cause));
				}
			});
		});
		try {
			expect(
				(
					await fetch(`${E2E_SSH.controlUrl}/transfer-peer?blocked=${blocked ? 1 : 0}&bandwidth=1024`, {
						method: 'POST',
					})
				).ok,
			).toBe(true);
			expect(
				(
					await fetch(
						`${E2E_SSH.controlUrl}/sftp/read-network?ms=${blocked ? 40 : 0}&bytesPerSecond=${blocked ? 1024 * 1024 : 0}`,
						{ method: 'POST' },
					)
				).ok,
			).toBe(true);
			// Both sessions are connected before copying: leaving Workspace deliberately clears its clipboard.
			await connectTestSshFromConnectionsPage(page, sourceId);
			await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
			await page.locator(`.workspace-connection-list [data-connection-id="${destinationId}"]`).click();
			await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-session-state', 'connected', {
				timeout: 35_000,
			});
			await expect(page.locator('.terminal-tab-shell').getByRole('tab')).toHaveCount(2);
			await page
				.getByRole('tab')
				.filter({ hasText: `Transfer peer ${E2E_SSH.port}` })
				.click();
			await openConnectedFileManager(page);
			await rightClickRow(page, filename);
			await clickMenuItem(page, 'Copy');
			await closeConnectedFileManager(page);
			await page
				.getByRole('tab')
				.filter({ hasText: `Transfer peer ${E2E_SSH.transferTargetPort}` })
				.click();
			await openConnectedFileManager(page);
			await goIntoFolder(page, 'folder-seed');
			const monitor = await page.evaluateHandle((name) => {
				const samples: Array<{ id: string; status: string; percent: number; text: string }> = [];

				const collect = () => {
					for (const row of document.querySelectorAll('.transfer-progress-window [data-task-id]')) {
						if (!row.textContent?.includes(name)) continue;
						const bar = row.querySelector('[role="progressbar"]');
						if (!bar) continue;
						const sample = {
							id: row.getAttribute('data-task-id') ?? '',
							status: row.getAttribute('data-task-status') ?? '',
							percent: Number(bar.getAttribute('aria-valuenow')),
							text: row.textContent ?? '',
						};
						if (JSON.stringify(sample) !== JSON.stringify(samples.at(-1))) samples.push(sample);
					}
				};

				const observer = new MutationObserver(collect);
				observer.observe(document.body, {
					subtree: true,
					childList: true,
					attributes: true,
					characterData: true,
				});
				return {
					samples,

					stop: () => observer.disconnect(),
				};
			}, filename);
			try {
				await openCurrentDirectoryContextMenu(page);
				await clickMenuItem(page, 'Paste');
				const confirmation = page.getByRole('dialog', { name: 'Please confirm', exact: true });
				await expect(confirmation).toBeVisible();
				await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click();
				const card = visibleProgressTask(page, filename);
				await expect(card).toBeVisible();
				await expect
					.poll(() => card.getByRole('progressbar').getAttribute('aria-valuenow'), { timeout: 30_000 })
					.toMatch(/^(?:[1-9]|[1-9][0-9])$/);
				const id = await card.getAttribute('data-task-id');
				expect(id).toBeTruthy();
				await expect
					.poll(() => taskEvents.find((event) => event.requestId === id && event.type === 'completed'), {
						timeout: 45_000,
					})
					.toMatchObject({
						crossSession: true,
						mode: 'copy',
						sourcePaths: [`/${filename}`],
						destinationPath: '/folder-seed',
					});
				// Completed client tasks retire automatically; do not require a transient 100% frame to paint.
				await expect(card).toHaveCount(0);
				const samples = await monitor.evaluate((state) => state.samples);
				const live = samples.filter((sample) => sample.id === id && sample.percent > 0 && sample.percent < 100);
				expect(new Set(live.map((sample) => sample.percent)).size).toBeGreaterThan(1);
				expect(live.some((sample) => /8(?:\.0)?\s*(?:MiB|MB)/.test(sample.text))).toBe(true);
				let previousPercent = 0;
				for (const sample of live) {
					expect(sample.percent).toBeGreaterThanOrEqual(previousPercent);
					previousPercent = sample.percent;
				}
				expect(protocolErrors).toEqual([]);
				expect(taskEvents.filter((event) => event.requestId === id && event.type === 'failed')).toEqual([]);
				expect(
					taskEvents.some(
						(event) =>
							event.requestId === id &&
							event.type === 'progress' &&
							event.totalKnown &&
							event.totalBytes === bytes.length &&
							event.transferredBytes > 0 &&
							event.transferredBytes < bytes.length,
					),
				).toBe(true);
				const actual = await readFile(path.join(root, 'folder-seed', filename));

				const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');

				expect(digest(actual)).toBe(digest(bytes));
				expect(digest(await readFile(path.join(root, filename)))).toBe(digest(bytes));
				const peer = await (await fetch(`${E2E_SSH.controlUrl}/transfer-peer`)).json();
				const reads = await (await fetch(`${E2E_SSH.controlUrl}/sftp/read-network`)).json();
				expect(peer.nativeTransfersStarted).toBe(blocked ? 0 : 1);
				expect(reads.sftpReadResponseBytes).toBe(blocked ? bytes.length : 0);
				await testInfo.attach('clipboard-ui-progress', {
					body: JSON.stringify({ blocked, samples, taskEvents, peer, reads }),
					contentType: 'application/json',
				});
			} finally {
				await monitor.evaluate((state) => state.stop());
				await monitor.dispose();
			}
		} finally {
			await fetch(`${E2E_SSH.controlUrl}/transfer-peer`, { method: 'POST' });
			await fetch(`${E2E_SSH.controlUrl}/sftp/read-network?ms=0`, { method: 'POST' });
		}
	});
}
