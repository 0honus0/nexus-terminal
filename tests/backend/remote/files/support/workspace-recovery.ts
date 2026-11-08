import { expect } from 'vitest';
import type { HttpClients } from '../../../../support/http/protocol-fixture.mjs';
import type { ControlledSsh } from '../../../../support/protocols/controlled-ssh-fixture.mjs';
import type { APIRequestContext } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { readWorkspaceFileListResponse } from '../../../../../packages/shared/src/remote/files/workspace-codec';
import { readDownloadTicketResponse } from '../../../../../packages/shared/src/remote/transfers/http-codec';
import { requestWorkspace, requestWorkspaceBinary } from '../../../../support/protocols/workspace-client';

const html = '<!doctype html><html><body><h1>HTML_REGRESSION_OK</h1></body></html>\n';
const directory = '/file-manager-regressions';
const archiveFiles = [
	{ name: 'index.html', bytes: Buffer.from(html) },
	{ name: 'nested/中文.txt', bytes: Buffer.from('nested ZIP regression\n') },
	{ name: 'nested/empty.txt', bytes: Buffer.alloc(0) },
];

export async function createFixtures(ssh: ControlledSsh): Promise<void> {
	await mkdir(join(ssh.root, directory, 'nested'), { recursive: true });
	for (const file of archiveFiles) await writeFile(join(ssh.root, directory, file.name), file.bytes);
	await writeFile(join(ssh.root, 'regression.html'), html);
}

export function directoryUrl(connectionId: number, workspaceId: string): string {
	return (
		'/api/v1/sftp/download-directory?' +
		new URLSearchParams({ connectionId: String(connectionId), sessionId: workspaceId, remotePath: directory })
	);
}

export async function setReadDelay(ssh: ControlledSsh, ms: number): Promise<void> {
	expect((await fetch(ssh.controlUrl + '/sftp/read-delay?ms=' + ms, { method: 'POST' })).ok).toBe(true);
}

export async function expectHandlesClosed(ssh: ControlledSsh): Promise<void> {
	await expect
		.poll(async () => {
			const response = await fetch(ssh.controlUrl + '/sftp/read-handles');
			expect(response.ok).toBe(true);
			const handles = await response.json();
			return handles.opened - handles.closed;
		})
		.toBe(0);
}

export async function waitForPendingRead(ssh: ControlledSsh): Promise<void> {
	await expect
		.poll(async () => {
			const response = await fetch(ssh.controlUrl + '/sftp/read-delay');
			expect(response.ok).toBe(true);
			return (await response.json()).sftpDelayedReadCount;
		})
		.toBeGreaterThan(0);
}

export async function expectWorkspaceUsable(
	request: APIRequestContext,
	workspace: Awaited<ReturnType<HttpClients['openWorkspace']>>,
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
		data: { connectionId, sessionId: workspace.workspaceId, remotePath: '/regression.html' },
	});
	try {
		expect(ticketResponse.status()).toBe(201);
		const ticket = readDownloadTicketResponse(await ticketResponse.json());
		const download = await request.get(ticket.url);
		try {
			expect(download.status()).toBe(200);
			expect(await download.body()).toEqual(Buffer.from(html));
		} finally {
			await download.dispose();
		}
	} finally {
		await ticketResponse.dispose();
	}
	const zip = await request.get(directoryUrl(connectionId, workspace.workspaceId));
	try {
		expect(zip.status()).toBe(200);
		expect(zip.headers()['content-type']).toContain('application/zip');
		await writeFile(archivePath, await zip.body());
		const entries = await promisify(execFile)('unzip', ['-Z1', archivePath]);
		expect(
			entries.stdout
				.trim()
				.split('\n')
				.filter((entry) => !entry.endsWith('/'))
				.sort(),
		).toEqual(archiveFiles.map((file) => file.name).sort());
		for (const file of archiveFiles) {
			const extracted = await promisify(execFile)('unzip', ['-p', archivePath, file.name], {
				encoding: 'buffer',
			});
			expect(extracted.stdout).toEqual(file.bytes);
		}
	} finally {
		await zip.dispose();
	}
}
