import { expect, test } from '../../support/fixtures';
import { E2E_URLS } from '../../../support/protocols/test-environment';
import type { SuspendedSessionView as SuspendedSession } from '../../../../packages/shared/src/remote/suspend/http';
import type { PresentationLayout } from '../../../../packages/shared/src/preferences/presentation/model';
import { readSuspendedSessionCatalog } from '../../../../packages/shared/src/remote/suspend/http-codec';
import { readWorkspaceSuspendViewport } from '../../../../packages/shared/src/remote/suspend/workspace-result-codec';
import {
	readPreferencesResponse,
	readLayoutResponse,
	readPresentationUpdateResponse,
} from '../../../../packages/shared/src/preferences/presentation/http-codec';
const headers = { Origin: E2E_URLS.frontendOrigin };
import { loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import {
	E2E_SSH,
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	ensureTestSshConnection,
	resetTestSshFilesystem,
} from '../../support/ssh';
import {
	acknowledgeTerminalOutput,
	closeWebSocket,
	decodeWorkspaceBinaryFrame,
	openAuthenticatedWebSocket,
	openWorkspaceSession,
	requestWorkspace,
	requestWorkspaceBinary,
	resumeSuspendedWorkspace,
	sendJson,
	waitForFilesystemReady,
	waitForBinaryText,
	waitForJson,
} from '../../../support/protocols/workspace-client';

test.use({ e2eServices: ['ssh'] });

test('marking suspend keeps the UI tab interactive and unmarking keeps the shell alive', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await resetTestSshFilesystem();
	const connectionId = await ensureTestSshConnection(context.request);
	await connectTestSshFromConnectionsPage(page, connectionId);
	const terminal = page.getByRole('application', { name: 'Terminal', exact: true });
	await expect(terminal).toBeVisible();
	const activeTab = page.getByRole('tab', { selected: true });
	const command = page.locator('input.command-bar-input');
	await command.fill(
		"for ((i=0;i<2000;i++)); do printf 'SNAPSHOT_PROFILE_%04d_abcdefghijklmnopqrstuvwxyz\\n' \"$i\"; done; printf 'SNAPSHOT_%s\\n' PROFILE_DONE",
	);
	const snapshotProfileLines = process.env.NEXUS_E2E_SMALL_SNAPSHOT_PROFILE === '1' ? 200 : 2000;
	if (snapshotProfileLines === 200) {
		await command.fill((await command.inputValue()).replace('i<2000', 'i<200'));
	}
	await command.press('Enter');
	await expect(terminal.locator('.xterm-rows')).toContainText('SNAPSHOT_PROFILE_DONE');
	const cdp = await context.newCDPSession(page);
	await cdp.send('Network.enable');
	let markStarted = 0;
	const suspendRequests = new Map<string, { phase: string; requestMs: number; snapshotBytes: number }>();
	const phaseSamples: Array<{ phase: string; requestMs: number; snapshotBytes: number; responseMs: number }> = [];
	let snapshotBytes = 0;
	let requestMs = 0;
	const markResponse = new Promise<number>((resolve) => {
		cdp.on('Network.webSocketFrameSent', ({ response }) => {
			if (response.opcode !== 1) return;
			const message = JSON.parse(response.payloadData);
			if (message.type !== 'suspend.prepare' && message.type !== 'suspend.commit') return;
			snapshotBytes = Buffer.byteLength(message.payload?.terminalSnapshot ?? '');
			requestMs = performance.now() - markStarted;
			suspendRequests.set(message.requestId, { phase: message.type, requestMs, snapshotBytes });
		});
		cdp.on('Network.webSocketFrameReceived', ({ response }) => {
			if (response.opcode !== 1) return;
			const message = JSON.parse(response.payloadData);
			if (message.type !== 'response') return;
			const sample = suspendRequests.get(message.requestId);
			if (!sample) return;
			suspendRequests.delete(message.requestId);
			const responseMs = performance.now() - markStarted;
			phaseSamples.push({ ...sample, responseMs });
			if (sample.phase === 'suspend.commit') resolve(responseMs);
		});
	});
	await activeTab.click({ button: 'right' });
	markStarted = performance.now();
	await page.getByRole('menu').getByRole('menuitem', { name: 'Suspend Session', exact: true }).click();
	const responseMs = await markResponse;
	expect(snapshotBytes).toBeGreaterThan(0);
	expect(snapshotBytes).toBeLessThanOrEqual(1024 * 1024);
	expect(phaseSamples.map((sample) => sample.phase)).toEqual(['suspend.prepare', 'suspend.commit']);
	console.log(
		'[browser suspend snapshot profile]',
		JSON.stringify({ snapshotProfileLines, requestMs, responseMs, snapshotBytes, phaseSamples }),
	);
	await cdp.detach();
	await expect(activeTab).toBeVisible();
	await expect(terminal).toBeVisible();
	await command.fill('echo MARKED_UI_ALIVE');
	await command.press('Enter');
	await expect(terminal.locator('.xterm-rows')).toContainText('MARKED_UI_ALIVE');
	await activeTab.click({ button: 'right' });
	await page.getByRole('menu').getByRole('menuitem', { name: 'Unmark Suspend', exact: true }).click();
	await command.fill('echo UNMARKED_UI_ALIVE');
	await command.press('Enter');
	await expect(terminal.locator('.xterm-rows')).toContainText('UNMARKED_UI_ALIVE');
});

test('stale suspended-session resume logs structured not-found diagnostics', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await resetTestSshFilesystem();
	const connectionId = await ensureTestSshConnection(context.request);
	const settingsResponse = await context.request.get('/api/v1/settings/preferences');
	expect(settingsResponse.ok()).toBe(true);
	const originalFrontendLogLevel = readPreferencesResponse(await settingsResponse.json()).preferences
		.frontendLogLevel;
	await updateUiPreferences(context.request, (preferences) => {
		preferences.frontendLogLevel = 'debug';
	});

	const original = await openWorkspaceSession(context.request, connectionId, `stale-resume-${crypto.randomUUID()}`);
	await requestWorkspace(original.socket, 'suspend.mark');
	await closeWebSocket(original.socket);

	let suspended: SuspendedSession | undefined;
	const catalogSocket = await openAuthenticatedWebSocket(context.request);
	try {
		for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
			const list = readSuspendedSessionCatalog(await requestWorkspace(catalogSocket, 'suspend.list'));
			suspended = list.find(
				(session) =>
					session.originalWorkspaceId === original.workspaceId &&
					session.status === 'active' &&
					session.ownershipState === 'available',
			);
			if (!suspended) await new Promise((resolve) => setTimeout(resolve, 100));
		}
	} finally {
		await closeWebSocket(catalogSocket);
	}
	expect(suspended).toBeTruthy();

	const frontendDebugLogs: Array<Record<string, unknown>> = [];
	page.on('console', (message) => {
		if (message.type() !== 'debug' && message.type() !== 'log') return;
		for (const argument of message.args()) {
			void argument
				.jsonValue()
				.then((value) => {
					if (value && typeof value === 'object' && typeof (value as { msg?: unknown }).msg === 'string') {
						frontendDebugLogs.push(value as Record<string, unknown>);
					}
				})
				.catch(() => undefined);
		}
	});

	let releaseSnapshot: (() => void) | undefined;
	const snapshotBarrier = new Promise<void>((resolve) => {
		releaseSnapshot = resolve;
	});
	let holdSnapshots = false;
	await page.routeWebSocket('**/ws/suspended-sessions', (socket) => {
		const server = socket.connectToServer();
		server.onMessage(async (message) => {
			if (holdSnapshots) await snapshotBarrier;
			socket.send(message);
		});
	});
	try {
		await page.goto('/workspace?openSuspended=1');
		const modal = page.getByRole('region', { name: 'Suspended SSH Sessions', exact: true });
		await expect(modal).toBeVisible({ timeout: 20_000 });
		const row = modal.locator(`[data-suspend-id="${suspended!.id}"]`);
		await expect(row).toBeVisible({ timeout: 20_000 });
		const resumeButton = row.getByRole('button', { name: 'Resume', exact: true });
		await expect(resumeButton).toBeVisible();

		holdSnapshots = true;
		const terminate = await context.request.delete(`/api/v1/ssh-suspend/terminate/${suspended!.id}`, { headers });
		expect(terminate.ok(), await terminate.text()).toBeTruthy();
		await resumeButton.click();

		await expect
			.poll(() =>
				frontendDebugLogs.some(
					(entry) =>
						entry.msg === 'Workspace request rejected' &&
						entry.operation === 'suspend.resume' &&
						entry.failureKind === 'request_rejected' &&
						entry.reason === 'not_found' &&
						entry.connectionId === connectionId,
				),
			)
			.toBeTruthy();
		await expect
			.poll(() =>
				frontendDebugLogs.some(
					(entry) =>
						entry.msg === 'Workspace suspended-session resume failed in view' &&
						entry.suspendedSessionId === suspended!.id &&
						entry.connectionId === connectionId,
				),
			)
			.toBeTruthy();
		expect(JSON.stringify(frontendDebugLogs)).not.toContain(E2E_SSH.password);
	} finally {
		releaseSnapshot?.();
		if (suspended)
			await context.request
				.delete(`/api/v1/ssh-suspend/terminate/${suspended.id}`, { headers })
				.catch(() => undefined);
		await updateUiPreferences(context.request, (preferences) => {
			preferences.frontendLogLevel = originalFrontendLogLevel;
		});
	}
});

test('resumed terminal preserves SGR wheel encoding requested by the remote TUI', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await resetTestSshFilesystem();
	const connectionId = await ensureTestSshConnection(context.request);
	const original = await openWorkspaceSession(context.request, connectionId, `suspend-mouse-${crypto.randomUUID()}`);
	await requestWorkspace(original.socket, 'suspend.mark', {
		terminalSnapshot: '\x1b[?1000h\x1b[?1006hMOUSE_MODE_READY\r\n',
	});
	await closeWebSocket(original.socket);

	let suspended: SuspendedSession | undefined;
	const catalogSocket = await openAuthenticatedWebSocket(context.request);
	try {
		for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
			const list = readSuspendedSessionCatalog(await requestWorkspace(catalogSocket, 'suspend.list'));
			suspended = list.find(
				(session) =>
					session.originalWorkspaceId === original.workspaceId &&
					session.status === 'active' &&
					session.ownershipState === 'available',
			);
			if (!suspended) await new Promise((resolve) => setTimeout(resolve, 100));
		}
	} finally {
		await closeWebSocket(catalogSocket);
	}
	expect(suspended).toBeTruthy();

	const terminalInput: string[] = [];
	let historyRequestCount = 0;
	page.on('websocket', (socket) => {
		socket.on('framesent', ({ payload }) => {
			if (typeof payload !== 'string') return;
			try {
				const message = JSON.parse(payload) as { type?: string; payload?: { data?: unknown } };
				if (message.type === 'terminal.input' && typeof message.payload?.data === 'string') {
					terminalInput.push(message.payload.data);
				} else if (message.type === 'suspend.history.previous') {
					historyRequestCount += 1;
				}
			} catch {
				// Ignore non-protocol frames from other sockets on the page.
			}
		});
	});

	await page.goto('/workspace?openSuspended=1');
	const modal = page.getByRole('region', { name: 'Suspended SSH Sessions', exact: true });
	await expect(modal).toBeVisible({ timeout: 20_000 });
	await modal.locator(`[data-suspend-id="${suspended!.id}"]`).getByRole('button', { name: 'Resume' }).click();
	await expect(page.getByText(/resumed successfully\.$/)).toBeVisible({ timeout: 20_000 });
	const terminal = page.locator('.terminal-inner-container:visible').first();
	await expect(terminal).toBeVisible();
	const box = await terminal.boundingBox();
	expect(box).toBeTruthy();
	await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
	for (let attempt = 0; attempt < 3; attempt += 1) await page.mouse.wheel(0, -350);
	await expect
		.poll(() => terminalInput.some((data) => /\x1b\[<64;\d+;\d+M/.test(data)), { timeout: 5_000 })
		.toBe(true);
	expect(historyRequestCount).toBe(0);
});

test('resumed terminal pages older history through a bounded window and restores the live tail', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await page.setViewportSize({ width: 1440, height: 900 });
	await resetTestSshFilesystem();
	const connectionId = await ensureTestSshConnection(context.request);

	const suspendedWorkspace = await openWorkspaceSession(
		context.request,
		connectionId,
		`suspend-ui-history-${crypto.randomUUID()}`,
	);
	const earlyMarker = 'LAZY_HISTORY_EARLIEST';
	const tailMarker = 'LAZY_HISTORY_LATEST';
	const filler = Array.from(
		{ length: 4500 },
		(_, index) => `ui-history-${String(index).padStart(5, '0')}-${'x'.repeat(44)}`,
	);
	const snapshot = `${earlyMarker}\r\n${filler.join('\r\n')}\r\n${tailMarker}\r\n`;
	expect(Buffer.byteLength(snapshot)).toBeGreaterThan(256 * 1024);
	expect(Buffer.byteLength(snapshot)).toBeLessThan(512 * 1024);

	await requestWorkspace(suspendedWorkspace.socket, 'suspend.mark', { terminalSnapshot: snapshot });
	await closeWebSocket(suspendedWorkspace.socket);

	let suspended: SuspendedSession | undefined;
	const catalogSocket = await openAuthenticatedWebSocket(context.request);
	try {
		for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
			const list = readSuspendedSessionCatalog(await requestWorkspace(catalogSocket, 'suspend.list'));
			suspended = list.find(
				(session) =>
					session.originalWorkspaceId === suspendedWorkspace.workspaceId &&
					session.status === 'active' &&
					session.ownershipState === 'available',
			);
			if (!suspended) await new Promise((resolve) => setTimeout(resolve, 100));
		}
	} finally {
		await closeWebSocket(catalogSocket);
	}
	expect(suspended).toBeTruthy();

	const layoutResponse = await context.request.get('/api/v1/settings/layout');
	expect(layoutResponse.ok()).toBeTruthy();
	const originalLayout = readLayoutResponse(await layoutResponse.json());
	const suspendedLayout = structuredClone(originalLayout.layout);

	const replaceEditorWithSuspended = (node: PresentationLayout): boolean => {
		if (node.type === 'pane' && node.component === 'editor') {
			node.component = 'suspendedSshSessions';
			return true;
		}
		return node.type === 'container' && node.children.some(replaceEditorWithSuspended);
	};

	expect(replaceEditorWithSuspended(suspendedLayout)).toBe(true);
	const savedLayout = await context.request.put('/api/v1/settings/layout', {
		headers,
		data: { expectedVersion: originalLayout.version, layout: suspendedLayout },
	});
	expect(savedLayout.ok()).toBe(true);
	expect(readPresentationUpdateResponse(await savedLayout.json()).version).toBe(originalLayout.version + 1);

	try {
		await connectTestSshFromConnectionsPage(page, connectionId);
		const suspendedPanel = page.locator('.suspended-sessions-panel:visible').first();
		await expect(suspendedPanel).toBeVisible({ timeout: 20_000 });
		const suspendedRow = suspendedPanel.locator(`[data-suspend-id="${suspended!.id}"]`);
		await expect(suspendedRow).toBeVisible({ timeout: 20_000 });
		let historyRequestCount = 0;
		let historyResponseCount = 0;
		const historyRequestIds = new Set<string>();
		let resumeStarted = 0;
		let resumeRequestMs: number | undefined;
		let resumeResponseMs: number | undefined;
		let resumeRequestId: string | undefined;
		page.on('websocket', (socket) => {
			socket.on('framesent', ({ payload }) => {
				if (typeof payload !== 'string') return;
				try {
					const message = JSON.parse(payload) as { type?: string; requestId?: string };
					if (message.type === 'suspend.resume') {
						resumeRequestId = message.requestId;
						resumeRequestMs = performance.now() - resumeStarted;
					}
					if (message.type === 'suspend.history.previous') {
						historyRequestCount += 1;
						if (message.requestId) historyRequestIds.add(message.requestId);
					}
				} catch {
					// Ignore binary/non-protocol frames from other sockets on the page.
				}
			});
			socket.on('framereceived', ({ payload }) => {
				if (typeof payload !== 'string') return;
				try {
					const message = JSON.parse(payload) as { type?: string; requestId?: string };
					if (message.type === 'response' && resumeRequestId && message.requestId === resumeRequestId)
						resumeResponseMs = performance.now() - resumeStarted;
					if (
						message.type === 'response' &&
						message.requestId &&
						historyRequestIds.delete(message.requestId)
					) {
						historyResponseCount += 1;
					}
				} catch {
					// Ignore binary/non-protocol frames from other sockets on the page.
				}
			});
		});
		const gateFilesystem = process.env.NEXUS_E2E_RESUME_FILESYSTEM_GATE === '1';
		if (gateFilesystem)
			expect((await fetch(`${E2E_SSH.controlUrl}/sftp/realpath-gate?blocked=1`, { method: 'POST' })).ok).toBe(
				true,
			);
		resumeStarted = performance.now();
		await suspendedRow.getByRole('button', { name: 'Resume', exact: true }).click();
		await expect(page.getByText(/resumed successfully\.$/)).toBeVisible({ timeout: 20_000 });
		const resumeSuccessVisibleMs = performance.now() - resumeStarted;
		expect(resumeRequestMs).toBeDefined();
		expect(resumeResponseMs).toBeDefined();
		if (gateFilesystem) {
			await expect
				.poll(async () => (await (await fetch(`${E2E_SSH.controlUrl}/sftp/realpath-gate`)).json()).pending)
				.toBe(1);
			expect((await fetch(`${E2E_SSH.controlUrl}/sftp/realpath-gate`, { method: 'POST' })).ok).toBe(true);
		}
		console.log(
			'[resume activation phases]',
			JSON.stringify({ resumeRequestMs, resumeResponseMs, resumeSuccessVisibleMs }),
		);

		const terminals = page.locator('.terminal-inner-container:visible');
		await expect(terminals).toHaveCount(1, { timeout: 20_000 });
		const terminal = terminals.first();
		const rows = terminal.locator('.xterm-rows');
		await expect
			.poll(async () => (await rows.locator(':scope > div').allTextContents()).join(''))
			.toContain(tailMarker);
		await expect(rows).not.toContainText(earlyMarker);

		const tailVisibleMs = performance.now() - resumeStarted;

		// xterm 6 uses a custom scrollable element; the legacy .xterm-viewport no longer exposes
		// the terminal's actual scrollTop/scrollHeight. Assert lazy paging at the protocol boundary
		// instead of reading obsolete DOM scroll metrics.
		await page.waitForTimeout(350);
		expect(historyRequestCount).toBe(0);

		const scrollable = terminal.locator('.xterm-scrollable-element').first();
		await expect(scrollable).toBeVisible();
		const scrollableBox = await scrollable.boundingBox();
		expect(scrollableBox).toBeTruthy();
		await page.mouse.move(
			scrollableBox!.x + scrollableBox!.width / 2,
			scrollableBox!.y + scrollableBox!.height / 2,
		);
		const scrollbar = scrollable.locator(':scope > .scrollbar.vertical').first();
		const slider = scrollbar.locator(':scope > .slider');

		const sliderBox = async () => {
			let box = await slider.boundingBox();
			await expect
				.poll(
					async () => {
						box = await slider.boundingBox();
						return Boolean(box && box.width > 0 && box.height > 0);
					},
					{ timeout: 10_000 },
				)
				.toBe(true);
			return box!;
		};

		const revealHistorySlider = async () => {
			const currentSliderBox = await sliderBox();
			// The right pane's splitter overlaps the scrollbar's right edge. Use its exposed left side.
			const x = currentSliderBox.x + 1;
			const y = currentSliderBox.y + currentSliderBox.height / 2;
			await page.mouse.move(x, y);
			await expect(scrollbar).toHaveClass(/(?:^|\s)visible(?:\s|$)/);
			expect(
				await page.evaluate(
					({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.scrollbar.vertical > .slider')),
					{ x, y },
				),
				'the drag must reach the terminal slider rather than the adjacent layout splitter',
			).toBe(true);
			return { x, y };
		};

		const dragHistorySliderToTop = async () => {
			const { x, y } = await revealHistorySlider();
			const scrollbarBox = await scrollbar.boundingBox();
			expect(scrollbarBox).toBeTruthy();
			await page.mouse.move(x, y);
			await page.mouse.down();
			await page.mouse.move(x, scrollbarBox!.y + 2, { steps: 8 });
			await page.mouse.up();
		};

		const dragHistorySliderToBottom = async () => {
			const { x, y } = await revealHistorySlider();
			const scrollbarBox = await scrollbar.boundingBox();
			expect(scrollbarBox).toBeTruthy();
			await page.mouse.move(x, y);
			await page.mouse.down();
			await page.mouse.move(x, scrollbarBox!.y + scrollbarBox!.height - 2, { steps: 8 });
			await page.mouse.up();
		};

		const renderedTerminalText = async (): Promise<string> =>
			(await rows.locator(':scope > div').allTextContents()).join('');

		const wheelUntil = async (
			deltaY: number,
			predicate: () => boolean | Promise<boolean>,
			failureMessage: string,
		): Promise<void> => {
			for (let attempt = 0; attempt < 30; attempt += 1) {
				if (await predicate()) return;
				await page.mouse.wheel(0, deltaY);
				await page.waitForTimeout(75);
			}
			expect(await predicate(), failureMessage).toBe(true);
		};

		await wheelUntil(-6_000, () => historyRequestCount > 0, 'scrolling upward should request older history');
		await expect.poll(() => historyResponseCount, { timeout: 10_000 }).toBeGreaterThan(0);

		for (
			let pageIndex = 0;
			pageIndex < 30 && !(await renderedTerminalText()).includes(earlyMarker);
			pageIndex += 1
		) {
			await dragHistorySliderToTop();
			await page.mouse.move(
				scrollableBox!.x + scrollableBox!.width / 2,
				scrollableBox!.y + scrollableBox!.height / 2,
			);
			await page.mouse.wheel(0, -6_000);
			await page.waitForTimeout(100);
			console.log('[history page]', {
				pageIndex,
				historyRequestCount,
				historyResponseCount,
				firstRow: (await rows.locator(':scope > div').first().textContent())?.slice(0, 40),
			});
		}
		expect(await renderedTerminalText()).toContain(earlyMarker);

		const requestsBeforeReturningToTail = historyRequestCount;
		await dragHistorySliderToBottom();
		await expect.poll(renderedTerminalText, { timeout: 10_000 }).toContain(tailMarker);
		await expect(rows).not.toContainText(earlyMarker);

		// Returning to the live tail resets the history cursor. Its bounded snapshot may fit entirely
		// in the viewport, so re-enter with the real upward wheel gesture even when no scrollbar is needed.
		// This must request the newest previous page rather than retain the exhausted browsing cursor.
		await page.mouse.move(
			scrollableBox!.x + scrollableBox!.width / 2,
			scrollableBox!.y + scrollableBox!.height / 2,
		);
		await wheelUntil(
			-6_000,
			() => historyRequestCount > requestsBeforeReturningToTail,
			're-entering history should request an older page',
		);
		await dragHistorySliderToBottom();
		await expect.poll(renderedTerminalText, { timeout: 10_000 }).toContain(tailMarker);
		const roundtripMarker = `RESUME_PROFILE_${crypto.randomUUID().replaceAll('-', '')}`;
		const command = page.locator('input.command-bar-input:visible');
		await expect(command).toHaveCount(1);
		const roundtripStarted = performance.now();
		await command.fill(`printf 'RESUME_%s\\n' '${roundtripMarker.slice('RESUME_'.length)}'`);
		await command.press('Enter');
		await expect.poll(renderedTerminalText).toContain(roundtripMarker);
		console.log(
			'[browser resume profile]',
			JSON.stringify({
				snapshotBytes: Buffer.byteLength(snapshot),
				tailVisibleMs,
				postHistoryRoundtripMs: performance.now() - roundtripStarted,
			}),
		);
	} finally {
		expect((await fetch(`${E2E_SSH.controlUrl}/sftp/realpath-gate`, { method: 'POST' })).ok).toBe(true);
		const latestResponse = await context.request.get('/api/v1/settings/layout');
		expect(latestResponse.ok()).toBe(true);
		const latest = readLayoutResponse(await latestResponse.json());
		const restored = await context.request.put('/api/v1/settings/layout', {
			headers,
			data: { expectedVersion: latest.version, layout: originalLayout.layout },
		});
		expect(restored.ok()).toBe(true);
		expect(readPresentationUpdateResponse(await restored.json()).version).toBe(latest.version + 1);
	}
});
