import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { readWorkspaceFileListResponse } from '../../../../packages/shared/src/remote/files/workspace-codec';
import { expect, type APIRequestContext } from '../../support/fixtures';
import { E2E_SSH } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import { openWorkspaceSession, requestWorkspace, requestWorkspaceBinary } from '../../support/ws';

export const html = '<!doctype html><html><body><h1>HTML_REGRESSION_OK</h1></body></html>\n';

export const directory = '/file-manager-regressions';

export const fixtureRoot = path.resolve('.tmp/ssh-root');

export const archiveFiles = [
	{ name: 'index.html', bytes: Buffer.from(html) },
	{ name: 'nested/中文.txt', bytes: Buffer.from('nested ZIP regression\n') },
	{ name: 'nested/empty.txt', bytes: Buffer.alloc(0) },
];

export async function createFixtures(): Promise<void> {
	await mkdir(path.join(fixtureRoot, directory, 'nested'), { recursive: true });
	for (const file of archiveFiles) {
		await writeFile(path.join(fixtureRoot, directory, file.name), file.bytes);
	}
	for (const filename of ['regression.html', 'regression.htm', 'missing.html', 'denied.html']) {
		await writeFile(path.join(fixtureRoot, filename), html);
	}
}

export async function expectExactZip(archivePath: string): Promise<void> {
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

export function directoryUrl(connectionId: number, workspaceId: string): string {
	return (
		'/api/v1/sftp/download-directory?' +
		new URLSearchParams({
			connectionId: String(connectionId),
			sessionId: workspaceId,
			remotePath: directory,
		})
	);
}

export async function expectWorkspaceUsable(
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

export async function setReadDelay(ms: number): Promise<void> {
	const response = await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay?ms=${ms}`, { method: 'POST' });
	expect(response.ok).toBe(true);
}

export async function waitForPendingRead(): Promise<void> {
	await expect
		.poll(async () => {
			const response = await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay`);
			expect(response.ok).toBe(true);
			return (await response.json()).sftpDelayedReadCount;
		})
		.toBeGreaterThan(0);
}

export async function expectHandlesClosed(): Promise<void> {
	await expect
		.poll(async () => {
			const response = await fetch(`${E2E_SSH.controlUrl}/sftp/read-handles`);
			expect(response.ok).toBe(true);
			const handles = (await response.json()) as { opened: number; closed: number };
			return handles.opened - handles.closed;
		})
		.toBe(0);
}
