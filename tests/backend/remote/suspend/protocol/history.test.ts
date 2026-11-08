import { test, expect, loginAsAdmin, HTTP_TEST_ORIGIN } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { createSshConnection } from '../../../../support/http/ssh-targets';
import type { SuspendedSessionView as SuspendedSession } from '../../../../../packages/shared/src/remote/suspend/http';
import { readSuspendedSessionCatalog } from '../../../../../packages/shared/src/remote/suspend/http-codec';
import { readWorkspaceSuspendViewport } from '../../../../../packages/shared/src/remote/suspend/workspace-result-codec';
import {
	acknowledgeTerminalOutput,
	closeWebSocket,
	decodeWorkspaceBinaryFrame,
	requestWorkspace,
	requestWorkspaceBinary,
	resumeSuspendedWorkspace,
	sendJson,
	waitForFilesystemReady,
	waitForBinaryText,
	waitForJson,
} from '../../../../support/protocols/workspace-client';
const headers = { Origin: HTTP_TEST_ORIGIN };

test('resizing a suspended fullscreen terminal is ordered after its checkpoint', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);

	const connectionId = await createSshConnection(request, ssh);
	const original = await httpClients.openWorkspace(connectionId, `suspend-resize-${crypto.randomUUID()}`);
	const originalColumns = 100;
	const originalRows = 30;
	const resumedColumns = 140;
	const resumedRows = 20;
	const snapshot = `\x1b[?1049h\x1b[2J\x1b[HRESIZE_BASELINE\x1b[${originalRows};1HSTATUS_${originalColumns}x${originalRows}`;

	// workspace.connect acknowledges attachment before the remote shell finishes startup.
	// Drain startup output through a real shell round trip before freezing the fullscreen image.
	const readyMarker = `RESIZE_READY_${crypto.randomUUID().replaceAll('-', '')}`;
	const ready = waitForBinaryText(original.socket, readyMarker);
	await requestWorkspace(original.socket, 'terminal.input', { data: `printf '${readyMarker}\\n'\n` });
	await ready;
	await requestWorkspace(original.socket, 'suspend.mark', { terminalSnapshot: snapshot });
	await closeWebSocket(original.socket);

	const recovery = await httpClients.openSocket();
	try {
		let suspended: SuspendedSession | undefined;
		for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
			const list = readSuspendedSessionCatalog(await requestWorkspace(recovery, 'suspend.list'));
			suspended = list.find(
				(session) =>
					session.originalWorkspaceId === original.workspaceId &&
					session.status === 'active' &&
					session.ownershipState === 'available',
			);
			if (!suspended) await new Promise((resolve) => setTimeout(resolve, 100));
		}
		expect(suspended).toBeTruthy();

		const initialChunks: Buffer[] = [];
		const presentationOrder: string[] = [];

		const onInitialMessage = (data: Buffer, isBinary: boolean) => {
			if (!isBinary) {
				const event = JSON.parse(data.toString());
				if (event.type === 'suspend.viewport') {
					const viewport = readWorkspaceSuspendViewport(event.payload);
					presentationOrder.push(`${viewport.stage}:${viewport.columns}x${viewport.rows}`);
				}
				return;
			}
			const frame = decodeWorkspaceBinaryFrame(Buffer.from(data));
			if (frame.kind === 'terminal') {
				initialChunks.push(Buffer.from(frame.data));
				presentationOrder.push('output');
			}
		};

		recovery.on('message', onInitialMessage);
		await resumeSuspendedWorkspace(recovery, {
			suspendedSessionId: suspended!.id,
			workspaceId: `resized-${crypto.randomUUID()}`,
			viewport: { columns: resumedColumns, rows: resumedRows },
		});
		recovery.off('message', onInitialMessage);
		const cached = Buffer.concat(initialChunks).toString('utf8');
		expect(presentationOrder[0]).toBe(`baseline:${originalColumns}x${originalRows}`);
		const liveViewport = presentationOrder.indexOf(`live:${resumedColumns}x${resumedRows}`);
		expect(liveViewport).toBeGreaterThan(presentationOrder.indexOf('output'));
		expect(cached).toContain('RESIZE_BASELINE');
		expect(cached).toContain(`STATUS_${originalColumns}x${originalRows}`);
		expect(cached).not.toContain(`STATUS_${resumedColumns}x${resumedRows}`);

		await requestWorkspace(recovery, 'suspend.unmark');
	} finally {
		await closeWebSocket(recovery);
	}
});

test('terminal output produced after marking is retained in suspended history', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);

	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId, `marked-history-${crypto.randomUUID()}`);
	const before = 'MARK_HISTORY_BEFORE';
	const after = 'MARK_HISTORY_AFTER';

	// Queue output before marking, then close the socket to hand the marked shell to the server.
	// Delayed output must still be retained after the attachment closes.
	await requestWorkspace(workspace.socket, 'terminal.input', {
		data: `(sleep 0.5; printf '${after}\\n') &\r`,
	});
	await new Promise((resolve) => setTimeout(resolve, 75));
	await requestWorkspace(workspace.socket, 'suspend.mark', {
		terminalSnapshot: `STALE_HISTORY_TEXT\r\x1b[31m${before}\x1b[0m\x1b[K\r\n\x1b[?1000h\x1b[?1006h`,
	});
	await closeWebSocket(workspace.socket);

	const verifier = await httpClients.openSocket();
	try {
		let suspended: SuspendedSession | undefined;
		for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
			const list = readSuspendedSessionCatalog(await requestWorkspace(verifier, 'suspend.list'));
			suspended = list.find(
				(session) =>
					session.originalWorkspaceId === workspace.workspaceId &&
					session.status === 'active' &&
					session.ownershipState === 'available',
			);
			if (!suspended) await new Promise((resolve) => setTimeout(resolve, 100));
		}
		expect(suspended).toBeTruthy();
		let text = '';
		await expect
			.poll(
				async () => {
					const exported = await request.get(`/api/v1/ssh-suspend/log/${suspended!.id}`);
					expect(exported.ok()).toBeTruthy();
					text = await exported.text();
					return text;
				},
				{ timeout: 5_000 },
			)
			.toContain(after);
		expect(text).toContain(before);
		expect(text).not.toContain('STALE_HISTORY_TEXT');
		expect(text).not.toContain('\x1b[');
		expect(
			(
				await request.delete(`/api/v1/ssh-suspend/terminate/${suspended!.id}`, {
					headers: { Origin: HTTP_TEST_ORIGIN },
				})
			).ok(),
		).toBeTruthy();
	} finally {
		await closeWebSocket(verifier);
	}
});

test('resume sends only the newest cached tail and pages older terminal history on demand', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);

	const connectionId = await createSshConnection(request, ssh);
	const original = await httpClients.openWorkspace(connectionId, `suspend-history-${crypto.randomUUID()}`);

	const earlyMarker = 'SUSPEND_HISTORY_EARLIEST';
	const tailMarker = 'SUSPEND_HISTORY_LATEST';
	const filler = Array.from(
		{ length: 5200 },
		(_, index) => `history-${String(index).padStart(5, '0')}-${'x'.repeat(112)}`,
	);
	const snapshot = `${earlyMarker}\r\n${filler.join('\r\n')}\r\n${tailMarker}\r\n`;
	expect(Buffer.byteLength(snapshot)).toBeGreaterThan(512 * 1024);
	expect(Buffer.byteLength(snapshot)).toBeLessThan(900 * 1024);

	const markStarted = performance.now();
	await requestWorkspace(original.socket, 'suspend.mark', { terminalSnapshot: snapshot });
	const markMs = performance.now() - markStarted;
	await closeWebSocket(original.socket);

	const recoverySocket = await httpClients.openSocket();
	try {
		let suspended: SuspendedSession | undefined;
		for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
			const list = readSuspendedSessionCatalog(await requestWorkspace(recoverySocket, 'suspend.list'));
			suspended = list.find(
				(session) =>
					session.originalWorkspaceId === original.workspaceId &&
					session.status === 'active' &&
					session.ownershipState === 'available',
			);
			if (!suspended) await new Promise((resolve) => setTimeout(resolve, 100));
		}
		expect(suspended).toBeTruthy();

		const initialChunks: Buffer[] = [];

		const onInitialMessage = (data: Buffer, isBinary: boolean) => {
			if (!isBinary) return;
			const frame = decodeWorkspaceBinaryFrame(Buffer.from(data));
			if (frame.kind === 'terminal') initialChunks.push(Buffer.from(frame.data));
		};

		recoverySocket.on('message', onInitialMessage);
		const resumedWorkspaceId = `resumed-history-${crypto.randomUUID()}`;
		const startedAt = Date.now();
		const resumed = await resumeSuspendedWorkspace(recoverySocket, {
			suspendedSessionId: suspended!.id,
			workspaceId: resumedWorkspaceId,
		});
		recoverySocket.off('message', onInitialMessage);

		const resumeMs = Date.now() - startedAt;
		expect(resumeMs).toBeLessThan(5_000);
		expect(resumed).toMatchObject({
			workspaceId: resumedWorkspaceId,
			resumedFrom: suspended!.id,
			historyAvailable: true,
		});
		const initialOutput = Buffer.concat(initialChunks).toString('utf8');
		const cachedTailEnd = initialOutput.indexOf(tailMarker);
		expect(cachedTailEnd).toBeGreaterThanOrEqual(0);
		const cachedTail = initialOutput.slice(0, cachedTailEnd + tailMarker.length);
		// commitResume can append live PTY output immediately after the cached history payload. Only
		// the bounded prefix through the known tail marker belongs to initial resume history.
		expect(Buffer.byteLength(cachedTail)).toBeLessThanOrEqual(256 * 1024);
		expect(cachedTail).toContain(tailMarker);
		expect(cachedTail).not.toContain(earlyMarker);

		let older = '';
		let firstPreviousPage: { data: { hasMore: boolean }; bytes: Buffer } | null = null;
		let hasMore = resumed.historyAvailable;
		let pages = 0;
		const pageSamples: Array<{ ms: number; bytes: number; hasMore: boolean }> = [];
		while (hasMore && pages < 10) {
			const pageStarted = performance.now();
			const page = await requestWorkspaceBinary<{ hasMore: boolean }>(recoverySocket, 'suspend.history.previous');
			pageSamples.push({
				ms: performance.now() - pageStarted,
				bytes: page.bytes.byteLength,
				hasMore: page.data.hasMore,
			});
			firstPreviousPage ??= page;
			const text = page.bytes.toString('utf8');
			older = text + older;
			hasMore = page.data.hasMore;
			pages += 1;
		}
		expect(hasMore).toBe(false);
		expect(pages).toBeGreaterThan(0);
		const restoredHistory = `${older}${cachedTail}`;
		expect(restoredHistory).toContain(earlyMarker);
		expect(restoredHistory).toContain(tailMarker);
		for (const line of filler) expect(restoredHistory).toContain(line);
		console.log(
			'[suspend history profile]',
			JSON.stringify({
				snapshotBytes: Buffer.byteLength(snapshot),
				markMs,
				resumeMs,
				cachedTailBytes: Buffer.byteLength(cachedTail),
				pageSamples,
			}),
		);

		const reset = await requestWorkspace<{ available: boolean }>(recoverySocket, 'suspend.history.reset');
		expect(reset.available).toBe(true);
		const replayedFirstPage = await requestWorkspaceBinary<{ hasMore: boolean }>(
			recoverySocket,
			'suspend.history.previous',
		);
		expect(replayedFirstPage.data).toEqual(firstPreviousPage!.data);
		expect(replayedFirstPage.bytes.equals(firstPreviousPage!.bytes)).toBe(true);
		await requestWorkspace(recoverySocket, 'suspend.history.reset');
		const boundedPage = await requestWorkspaceBinary<{ hasMore: boolean }>(
			recoverySocket,
			'suspend.history.previous',
			{
				maxBytes: 16 * 1024,
			},
		);
		expect(boundedPage.bytes.byteLength).toBeLessThanOrEqual(16 * 1024);
		expect(boundedPage.data.hasMore).toBe(true);
		await requestWorkspace(recoverySocket, 'suspend.unmark');
	} finally {
		await closeWebSocket(recoverySocket);
	}
});
