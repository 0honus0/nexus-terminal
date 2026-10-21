import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { readWorkspaceFileListResponse } from '../../../../packages/shared/src/remote/files/workspace-codec';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
	E2E_SSH,
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	ensureTestSshConnection,
	fileManagerRow,
	openConnectedFileManager,
} from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import {
	closeWebSocket,
	openWorkspaceSession,
	requestWorkspace,
	requestWorkspaceBinary,
	waitForFilesystemReady,
	WorkspaceRequestFailure,
} from '../../support/ws';

const html = '<!doctype html><html><body><h1>HTML_REGRESSION_OK</h1></body></html>\n';
const directory = '/file-manager-regressions';
const fixtureRoot = path.resolve('.tmp/ssh-root');
const archiveFiles = [
	{ name: 'index.html', bytes: Buffer.from(html) },
	{ name: 'nested/中文.txt', bytes: Buffer.from('nested ZIP regression\n') },
	{ name: 'nested/empty.txt', bytes: Buffer.alloc(0) },
];

async function createFixtures(): Promise<void> {
	await mkdir(path.join(fixtureRoot, directory, 'nested'), { recursive: true });
	for (const file of archiveFiles) {
		await writeFile(path.join(fixtureRoot, directory, file.name), file.bytes);
	}
	for (const filename of ['regression.html', 'regression.htm', 'missing.html', 'denied.html']) {
		await writeFile(path.join(fixtureRoot, filename), html);
	}
}

async function expectExactZip(archivePath: string): Promise<void> {
	const entries = await promisify(execFile)('unzip', ['-Z1', archivePath]);
	expect(
		entries.stdout
			.trim()
			.split('\n')
			.filter((entry) => !entry.endsWith('/'))
			.sort(),
	).toEqual(archiveFiles.map((file) => file.name).sort());
	for (const file of archiveFiles) {
		const extracted = await promisify(execFile)('unzip', ['-p', archivePath, file.name], { encoding: 'buffer' });
		expect(extracted.stdout).toEqual(file.bytes);
	}
}

function directoryUrl(connectionId: number, workspaceId: string): string {
	return (
		'/api/v1/sftp/download-directory?' +
		new URLSearchParams({
			connectionId: String(connectionId),
			sessionId: workspaceId,
			remotePath: directory,
		})
	);
}

async function expectWorkspaceUsable(
	request: APIRequestContext,
	workspace: Awaited<ReturnType<typeof openWorkspaceSession>>,
	connectionId: number,
	archivePath: string,
): Promise<void> {
	const listing = readWorkspaceFileListResponse(
		await requestWorkspace(workspace.socket, 'filesystem.list', { path: '/' }),
	);
	expect(listing.path).toBe('/');
	expect(listing.entries).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ path: '/regression.html', name: 'regression.html' }),
			expect.objectContaining({ path: directory, name: directory.slice(1) }),
		]),
	);
	const read = await requestWorkspaceBinary(workspace.socket, 'filesystem.readBinary', {
		path: '/regression.html',
		maxBytes: 1024,
	});
	expect(read.bytes).toEqual(Buffer.from(html));
	const content = 'same Workspace save ' + crypto.randomUUID();
	await requestWorkspace(workspace.socket, 'filesystem.writeText', {
		path: '/saved.html',
		content,
		encoding: 'utf-8',
	});
	const saved = await requestWorkspaceBinary(workspace.socket, 'filesystem.readBinary', {
		path: '/saved.html',
		maxBytes: 1024,
	});
	expect(saved.bytes).toEqual(Buffer.from(content));
	const ticketResponse = await request.post('/api/v1/sftp/download-ticket', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: { connectionId, sessionId: workspace.workspaceId, remotePath: '/regression.html' },
	});
	expect(ticketResponse.status()).toBe(201);
	const ticket = (await ticketResponse.json()) as { url: string };
	const download = await request.get(ticket.url);
	try {
		expect(download.status()).toBe(200);
		expect(await download.body()).toEqual(Buffer.from(html));
	} finally {
		await download.dispose();
		await ticketResponse.dispose();
	}
	const zip = await request.get(directoryUrl(connectionId, workspace.workspaceId));
	try {
		expect(zip.status()).toBe(200);
		expect(zip.headers()['content-type']).toContain('application/zip');
		await writeFile(archivePath, await zip.body());
		await expectExactZip(archivePath);
	} finally {
		await zip.dispose();
	}
}

async function setReadDelay(ms: number): Promise<void> {
	const response = await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay?ms=${ms}`, { method: 'POST' });
	expect(response.ok).toBe(true);
}

async function waitForPendingRead(): Promise<void> {
	await expect
		.poll(async () => {
			const response = await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay`);
			expect(response.ok).toBe(true);
			return (await response.json()).sftpDelayedReadCount;
		})
		.toBeGreaterThan(0);
}

async function expectHandlesClosed(): Promise<void> {
	await expect
		.poll(async () => {
			const response = await fetch(`${E2E_SSH.controlUrl}/sftp/read-handles`);
			expect(response.ok).toBe(true);
			const handles = (await response.json()) as { opened: number; closed: number };
			return handles.opened - handles.closed;
		})
		.toBe(0);
}

test('HTML and HTM open in the editor, read failures stay local, and the folder menu downloads exact ZIP contents', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await createFixtures();
	const connectionId = await ensureTestSshConnection(context.request);
	await connectTestSshFromConnectionsPage(page, connectionId);
	await openConnectedFileManager(page);
	const popup = page.locator('[data-document-mode][data-workspace-active="true"]:visible').first();
	for (const filename of ['regression.html', 'regression.htm']) {
		await fileManagerRow(page, filename).dblclick();
		const editor = popup.locator('.file-editor-container');
		await expect(editor).toBeVisible();
		await expect
			.poll(() => editor.locator('.monaco-editor .view-lines').innerText())
			.toContain('HTML_REGRESSION_OK');
		await popup.getByTitle('Close Editor', { exact: true }).first().click();
	}
	await expect(fileManagerRow(page, 'missing.html')).toBeVisible();
	await rm(path.join(fixtureRoot, 'missing.html'));
	await fileManagerRow(page, 'missing.html').dblclick();
	await expect(
		page.getByText(
			'The file or active file session was not found. Refresh the directory; if this persists, reconnect the SSH session.',
			{ exact: true },
		),
	).toBeVisible();
	await popup.getByTitle('Close Editor', { exact: true }).first().click();
	await expect(popup).toBeHidden();
	try {
		expect(
			(await fetch(`${E2E_SSH.controlUrl}/sftp/stat-deny-prefix?path=%2Fdenied.html`, { method: 'POST' })).ok,
		).toBe(true);
		await fileManagerRow(page, 'denied.html').dblclick();
		await expect(
			page.getByText('Access to this path was denied. Check remote file and directory permissions.', {
				exact: true,
			}),
		).toBeVisible();
		await popup.getByTitle('Close Editor', { exact: true }).first().click();
		await expect(popup).toBeHidden();
	} finally {
		expect((await fetch(`${E2E_SSH.controlUrl}/sftp/stat-deny-prefix?path=`, { method: 'POST' })).ok).toBe(true);
	}
	const manager = page.getByRole('dialog', { name: 'File Manager', exact: true });
	await manager.getByTitle('Refresh', { exact: true }).click();
	await expect(fileManagerRow(page, 'missing.html')).toHaveCount(0);
	await fileManagerRow(page, directory.slice(1)).click({ button: 'right' });
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('menu').getByText('Download Folder', { exact: true }).click();
	const download = await downloadPromise;
	expect(await download.failure()).toBeNull();
	const archivePath = await download.path();
	expect(archivePath).toBeTruthy();
	await expectExactZip(archivePath!);
	await fileManagerRow(page, 'regression.html').dblclick();
	await expect.poll(() => popup.locator('.monaco-editor .view-lines').innerText()).toContain('HTML_REGRESSION_OK');
});

test('a Workspace idle beyond two minutes still lists, opens HTML, saves, issues tickets and downloads folders', async ({
	request,
}, testInfo) => {
	test.setTimeout(180_000);
	await loginAsInitialAdmin(request);
	await createFixtures();
	const connectionId = await ensureTestSshConnection(request);
	const workspace = await openWorkspaceSession(request, connectionId);
	try {
		await waitForFilesystemReady(workspace.socket);
		const idleStarted = performance.now();
		await new Promise((resolve) => setTimeout(resolve, 125_000));
		expect(performance.now() - idleStarted).toBeGreaterThan(120_000);
		expect(workspace.socket.readyState).toBe(1);
		await expectWorkspaceUsable(request, workspace, connectionId, testInfo.outputPath('idle.zip'));
		await expectHandlesClosed();
	} finally {
		await closeWebSocket(workspace.socket);
	}
});

test('cancelling an in-flight binary read preserves the original Workspace for editing and folder downloads', async ({
	request,
}, testInfo) => {
	await loginAsInitialAdmin(request);
	await createFixtures();
	const connectionId = await ensureTestSshConnection(request);
	const workspace = await openWorkspaceSession(request, connectionId);
	let pending: Promise<unknown> | undefined;
	try {
		await waitForFilesystemReady(workspace.socket);
		await setReadDelay(3000);
		const requestId = crypto.randomUUID();
		pending = requestWorkspaceBinary(
			workspace.socket,
			'filesystem.readBinary',
			{ path: '/regression.html', maxBytes: 1024 },
			requestId,
		).then(
			() => ({ completed: true }),
			(error: unknown) => {
				if (!(error instanceof WorkspaceRequestFailure)) throw error;
				return { error: error.code };
			},
		);
		await waitForPendingRead();
		expect(await requestWorkspace(workspace.socket, 'filesystem.cancelRead', { requestId })).toBe(true);
		expect(await pending).toEqual({ error: 'remote_unavailable' });
		await expectHandlesClosed();
		await setReadDelay(0);
		await expectWorkspaceUsable(request, workspace, connectionId, testInfo.outputPath('after-cancel.zip'));
		await expectHandlesClosed();
	} finally {
		try {
			await setReadDelay(0);
		} finally {
			await closeWebSocket(workspace.socket);
			if (pending) await pending;
		}
	}
});

test('aborting a directory ZIP during remote READ preserves the original Workspace and closes transfer handles', async ({
	request,
}, testInfo) => {
	await loginAsInitialAdmin(request);
	await createFixtures();
	const connectionId = await ensureTestSshConnection(request);
	const workspace = await openWorkspaceSession(request, connectionId);
	const controller = new AbortController();
	let pending: Promise<string> | undefined;
	try {
		await waitForFilesystemReady(workspace.socket);
		await setReadDelay(3000);
		const cookie = (await request.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join('; ');
		pending = fetch(new URL(directoryUrl(connectionId, workspace.workspaceId), E2E_URLS.frontendOrigin), {
			headers: { Cookie: cookie },
			signal: controller.signal,
		})
			.then(async (response) => {
				expect(response.status).toBe(200);
				await response.arrayBuffer();
				return 'completed';
			})
			.catch((error: unknown) => {
				if (!(error instanceof Error) || error.name !== 'AbortError') throw error;
				return error.name;
			});
		await waitForPendingRead();
		controller.abort();
		expect(await pending).toBe('AbortError');
		await expectHandlesClosed();
		await setReadDelay(0);
		await expectWorkspaceUsable(request, workspace, connectionId, testInfo.outputPath('after-abort.zip'));
		await expectHandlesClosed();
	} finally {
		controller.abort();
		try {
			await setReadDelay(0);
		} finally {
			await closeWebSocket(workspace.socket);
			if (pending) await pending;
		}
	}
});
