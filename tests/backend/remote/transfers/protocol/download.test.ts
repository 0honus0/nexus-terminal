import { profileSampleCount } from '../../../../support/profile-samples';
import { expect, test as sshTest, HTTP_TEST_ORIGIN } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { useHttpProtocol } from '../../../../support/http/protocol-fixture.mjs';
import type { HttpClients } from '../../../../support/http/protocol-fixture.mjs';

// Ticket ownership varies the source through the same explicit loopback proxy trust as the browser environment.
const test = sshTest.extend<{ httpClients: HttpClients }>({
	httpClients: async ({ ssh }, use) => {
		await useHttpProtocol(use, { origin: HTTP_TEST_ORIGIN, port: 0, trustedProxies: ['loopback'] });
	},
});
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { loginAsAdmin } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { createSshConnection } from '../../../../support/http/ssh-targets.ts';
import {
	closeWebSocket,
	requestWorkspace,
	waitForFilesystemReady,
} from '../../../../support/protocols/workspace-client';

const query = (values: Record<string, string | number>): string =>
	new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)])).toString();

test('profile streamed directory ZIP with exact extracted files under READ delay', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const root = path.join(ssh.root, 'zip-download-profile');
	await mkdir(root, { recursive: true });
	const files = Array.from({ length: 4 }, (_, index) => ({
		name: `file-${index}.bin`,
		bytes: Buffer.alloc(256 * 1024, 0x31 + index),
	}));
	for (const file of files) await writeFile(path.join(root, file.name), file.bytes);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId);
	const control = `${ssh.controlUrl}/sftp/read-network`;
	const samples = [];
	try {
		await waitForFilesystemReady(workspace.socket);
		for (const delayMs of [0, 20]) {
			for (let sample = 0; sample < profileSampleCount; sample++) {
				expect((await fetch(`${control}?ms=${delayMs}&bytesPerSecond=0`, { method: 'POST' })).ok).toBe(true);
				const start = performance.now();
				const response = await request.get(
					`/api/v1/sftp/download-directory?${query({ connectionId, sessionId: workspace.workspaceId, remotePath: '/zip-download-profile' })}`,
				);
				try {
					expect(response.status()).toBe(200);
					const zip = await response.body();
					const ms = performance.now() - start;
					const archivePath = path.join(ssh.directory, `directory-${delayMs}-${sample}.zip`);
					await writeFile(archivePath, zip);
					const entries = await promisify(execFile)('unzip', ['-Z1', archivePath]);
					expect(entries.stdout.trim().split('\n').sort()).toEqual(files.map((file) => file.name).sort());
					for (const file of files) {
						const extracted = await promisify(execFile)('unzip', ['-p', archivePath, file.name], {
							encoding: 'buffer',
							maxBuffer: 1024 * 1024,
						});
						expect(extracted.stdout).toEqual(file.bytes);
					}
					await expect.poll(async () => (await (await fetch(control)).json()).sftpReadPending).toBe(0);
					const metrics = await (await fetch(control)).json();
					expect(metrics.sftpReadResponseBytes).toBe(1024 * 1024);
					samples.push({ delayMs, sample, ms, zipBytes: zip.length, ...metrics });
				} finally {
					await response.dispose();
				}
			}
		}
		await expect
			.poll(async () => {
				const response = await fetch(`${ssh.controlUrl}/sftp/read-handles`);
				expect(response.ok).toBe(true);
				const handles = await response.json();
				return handles.opened - handles.closed;
			})
			.toBe(0);
		console.log('[directory ZIP profile]', JSON.stringify(samples));
	} finally {
		try {
			expect((await fetch(`${control}?ms=0&bytesPerSecond=0`, { method: 'POST' })).ok).toBe(true);
		} finally {
			await closeWebSocket(workspace.socket);
		}
	}
});

test('HTTP download ticket, Range, inline file, and directory ZIP work for an active SSH session', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const connectionId = await createSshConnection(request, ssh);
	const session = await httpClients.openWorkspace(connectionId, `filesystem-${crypto.randomUUID()}`);

	try {
		await waitForFilesystemReady(session.socket);

		const ticketResponse = await request.post('/api/v1/sftp/download-ticket', {
			headers: { Origin: HTTP_TEST_ORIGIN },
			data: {
				connectionId,
				sessionId: session.workspaceId,
				remotePath: '/seed.txt',
			},
		});
		expect(ticketResponse.status()).toBe(201);
		const ticket = (await ticketResponse.json()) as { url: string; expiresInSeconds: number };
		expect(ticket.expiresInSeconds).toBe(300);

		const ownerHeaders = { 'X-Forwarded-For': '203.0.113.10' };
		const headResponse = await request.head(ticket.url, { headers: ownerHeaders });
		expect(headResponse.status()).toBe(200);
		expect(headResponse.headers()['accept-ranges']).toBe('bytes');
		expect(Number(headResponse.headers()['content-length'])).toBe(Buffer.byteLength('nexus-e2e-seed\n'));

		const probeResponse = await request.get(ticket.url, { headers: ownerHeaders });
		expect(probeResponse.status()).toBe(200);
		expect(probeResponse.headers()['content-disposition']).toContain('seed.txt');
		expect((await probeResponse.body()).toString('utf8')).toBe('nexus-e2e-seed\n');

		const retryAfterProbe = await request.get(ticket.url, { headers: ownerHeaders });
		expect(retryAfterProbe.status()).toBe(200);
		expect((await retryAfterProbe.body()).toString('utf8')).toBe('nexus-e2e-seed\n');

		const rangeResponse = await request.get(ticket.url, {
			headers: { ...ownerHeaders, Range: 'bytes=0-4' },
		});
		expect(rangeResponse.status()).toBe(206);
		expect(rangeResponse.headers()['content-range']).toBe('bytes 0-4/15');
		expect((await rangeResponse.body()).toString('utf8')).toBe('nexus');

		const competingClient = await request.get(ticket.url, {
			headers: { 'X-Forwarded-For': '198.51.100.20', Range: 'bytes=5-9' },
		});
		expect(competingClient.status()).toBe(423);

		const remainder = await request.get(ticket.url, {
			headers: { ...ownerHeaders, Range: 'bytes=5-' },
		});
		expect(remainder.status()).toBe(206);
		expect((await remainder.body()).toString('utf8')).toBe('-e2e-seed\n');

		const reusableAfterRanges = await request.head(ticket.url, { headers: ownerHeaders });
		expect(reusableAfterRanges.status()).toBe(200);

		const inlineResponse = await request.get(
			`/api/v1/sftp/download?${query({
				connectionId,
				sessionId: session.workspaceId,
				remotePath: '/seed.txt',
				disposition: 'inline',
			})}`,
		);
		expect(inlineResponse.status()).toBe(200);
		expect((await inlineResponse.body()).toString('utf8')).toBe('nexus-e2e-seed\n');

		const directoryResponse = await request.get(
			`/api/v1/sftp/download-directory?${query({
				connectionId,
				sessionId: session.workspaceId,
				remotePath: '/folder-seed',
			})}`,
		);
		expect(directoryResponse.status()).toBe(200);
		expect(directoryResponse.headers()['content-type']).toContain('application/zip');
		const zip = await directoryResponse.body();
		expect(zip.subarray(0, 2).toString('ascii')).toBe('PK');

		const capacityUrls: string[] = [];
		// The original reusable ticket above counts toward the per-user 64
		// lease limit. Overflow is refused; a live ticket is never silently
		// evicted to make room for a new bearer capability.
		for (let index = 0; index < 63; index += 1) {
			const issued = await request.post('/api/v1/sftp/download-ticket', {
				headers: { Origin: HTTP_TEST_ORIGIN },
				data: {
					connectionId,
					sessionId: session.workspaceId,
					remotePath: '/seed.txt',
				},
			});
			expect(issued.status()).toBe(201);
			capacityUrls.push(((await issued.json()) as { url: string }).url);
		}
		const excess = await request.post('/api/v1/sftp/download-ticket', {
			headers: { Origin: HTTP_TEST_ORIGIN },
			data: { connectionId, sessionId: session.workspaceId, remotePath: '/seed.txt' },
		});
		expect(excess.status()).toBe(429);
		expect(await excess.json()).toEqual({ message: 'limit_exceeded' });
		const retained = await request.head(capacityUrls[0], {
			headers: { 'X-Forwarded-For': '203.0.113.30' },
		});
		expect(retained.status()).toBe(200);
		const newest = await request.get(capacityUrls.at(-1)!, {
			headers: { 'X-Forwarded-For': '203.0.113.30' },
		});
		expect(newest.status()).toBe(200);
		expect((await newest.body()).toString('utf8')).toBe('nexus-e2e-seed\n');

		// A ticket issued before a remote file mutation must fail closed even
		// when the user's ticket registry is already at its capacity ceiling.
		const changedFileTicket = capacityUrls.at(-2)!;
		await requestWorkspace(session.socket, 'filesystem.writeText', {
			path: '/seed.txt',
			content: 'ticket-invalidated-after-remote-change\n',
			encoding: 'utf-8',
		});
		const invalidated = await request.get(changedFileTicket, {
			headers: { 'X-Forwarded-For': '203.0.113.40' },
		});
		expect(invalidated.status()).toBe(410);
	} finally {
		await closeWebSocket(session.socket);
	}
});
