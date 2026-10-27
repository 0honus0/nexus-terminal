import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import { closeWebSocket, openWorkspaceSession, waitForFilesystemReady } from '../../support/ws';

for (const profile of [
	{ name: 'local-good', delay: 0, rate: 0, streams: 1 },
	{ name: '20ms', delay: 20, rate: 0, streams: 1 },
	{ name: '80ms', delay: 80, rate: 0, streams: 1 },
	{ name: '200ms', delay: 200, rate: 0, streams: 1 },
	{ name: 'good-100Mbps', delay: 20, rate: 12_500_000, streams: 1 },
	{ name: 'weak-10Mbps', delay: 80, rate: 1_250_000, streams: 1 },
	{ name: 'weak-2Mbps', delay: 200, rate: 250_000, streams: 1 },
	{ name: '80ms-four-streams', delay: 80, rate: 0, streams: 4 },
]) {
	test(`download network profile ${profile.name}`, async ({ request }, testInfo) => {
		await loginAsInitialAdmin(request);
		await resetTestSshFilesystem();
		// 4MiB at 2Mbps necessarily exceeds CI's 15s HTTP deadline. Two MiB still
		// crosses two full prefetch windows without changing the request timeout.
		const payload = Buffer.alloc((profile.rate === 250_000 ? 2 : 4) * 1024 * 1024);
		for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
		const expectedHash = createHash('sha256').update(payload).digest('hex');
		await writeFile(path.resolve('.tmp/ssh-root/network-profile.bin'), payload);
		const connectionId = await ensureTestSshConnection(request);
		const workspace = await openWorkspaceSession(request, connectionId);
		const control = `${E2E_SSH.controlUrl}/sftp/read-network`;
		const measurements = [];
		try {
			await waitForFilesystemReady(workspace.socket);
			for (let sample = 0; sample < 3; sample++) {
				expect(
					(await fetch(`${control}?ms=${profile.delay}&bytesPerSecond=${profile.rate}`, { method: 'POST' }))
						.ok,
				).toBeTruthy();
				const start = performance.now();
				const streams = await Promise.all(
					Array.from({ length: profile.streams }, async () => {
						const response = await request.get(
							`/api/v1/sftp/download?connectionId=${connectionId}&sessionId=${workspace.workspaceId}&remotePath=%2Fnetwork-profile.bin`,
						);
						expect(response.status()).toBe(200);
						const bytes = await response.body();
						const ms = performance.now() - start;
						expect(bytes.length).toBe(payload.length);
						expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedHash);
						await response.dispose();
						return { ms, MiBps: payload.length / 1048576 / (ms / 1000) };
					}),
				);
				const ms = Math.max(...streams.map((stream) => stream.ms));
				const state = await (await fetch(control)).json();
				expect(state.sftpReadPending).toBe(0);
				expect(state.sftpReadResponseBytes).toBe(payload.length * profile.streams);
				measurements.push({
					sample,
					ms,
					aggregateMiBps: (payload.length * profile.streams) / 1048576 / (ms / 1000),
					streams,
					...state,
				});
			}
			console.log('DOWNLOAD_NETWORK_RESULT', JSON.stringify({ profile, measurements }));
			await testInfo.attach('download-network-results', {
				body: JSON.stringify({ profile, measurements }, null, 2),
				contentType: 'application/json',
			});
		} finally {
			await expect.poll(async () => (await (await fetch(control)).json()).sftpReadPending).toBe(0);
			expect((await fetch(`${control}?ms=0&bytesPerSecond=0`, { method: 'POST' })).ok).toBeTruthy();
			await closeWebSocket(workspace.socket);
		}
	});
}
