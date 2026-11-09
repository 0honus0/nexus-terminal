import { profileSampleCount } from '../../../../support/profile-samples';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { loginAsAdmin } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { createSshConnection, trustSshHostKey } from '../../../../support/http/ssh-targets.ts';
import {
	closeWebSocket,
	openAuthenticatedWebSocket,
	openWorkspaceSession,
	requestWorkspace,
	waitForFilesystemReady,
	waitForJson,
} from '../../../../support/protocols/workspace-client';

test('profile small uploads by ready, transfer and commit phases with exact remote bytes', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const workspace = await httpClients.openWorkspace(await createSshConnection(request, ssh));
	const results = [];
	try {
		await waitForFilesystemReady(workspace.socket);
		const commitProfile = process.env.NEXUS_E2E_UPLOAD_COMMIT_PROFILE === '1';
		const conditions = commitProfile
			? [
					{ writeDelayMs: 0, statDelayMs: 0 },
					{ writeDelayMs: 0, statDelayMs: 60 },
				]
			: [
					{ writeDelayMs: 0, statDelayMs: 0 },
					{ writeDelayMs: 60, statDelayMs: 0 },
				];
		for (const { writeDelayMs, statDelayMs } of conditions) {
			expect(
				(
					await fetch(`${ssh.controlUrl}/sftp/stat-delay?ms=${statDelayMs}&prefix=%2Fsmall-`, {
						method: 'POST',
					})
				).ok,
			).toBe(true);
			expect((await fetch(`${ssh.controlUrl}/sftp/write-delay?ms=${writeDelayMs}`, { method: 'POST' })).ok).toBe(
				true,
			);
			for (let sample = 0; sample < profileSampleCount; sample++) {
				const uploadId = `small-${crypto.randomUUID()}`;
				const destinationPath = `/small-${uploadId}.bin`;
				const payload = Buffer.alloc(4096, sample + 1);
				const ready = waitForJson(
					workspace.socket,
					(message) =>
						message.type === 'transfer.upload' &&
						message.payload?.uploadId === uploadId &&
						message.payload?.type === 'ready',
				);
				const start = performance.now();
				await requestWorkspace(workspace.socket, 'upload.start', {
					uploadId,
					destinationPath,
					size: payload.length,
					conflictPolicy: 'overwrite',
				});
				await ready;
				const readyMs = performance.now() - start;
				const completed = waitForJson(
					workspace.socket,
					(message) =>
						message.type === 'transfer.upload' &&
						message.payload?.uploadId === uploadId &&
						message.payload?.type === 'completed',
				);
				const progress = waitForJson(
					workspace.socket,
					(message) =>
						message.type === 'transfer.upload' &&
						message.payload?.uploadId === uploadId &&
						message.payload?.type === 'progress' &&
						message.payload?.bytesWritten === payload.length,
				);
				const socket = await httpClients.openSocket(
					`/ws/uploads?workspaceId=${encodeURIComponent(workspace.workspaceId)}&uploadId=${encodeURIComponent(uploadId)}&size=${payload.length}`,
				);
				try {
					const sent = performance.now();
					socket.send(payload);
					await progress;
					const written = performance.now();
					await completed;
					const ended = performance.now();
					expect(await readFile(path.join(ssh.root, destinationPath.slice(1)))).toEqual(payload);
					expect(
						(await readdir(path.join(ssh.root))).some(
							(name) => name.includes(uploadId) && name.endsWith('.part'),
						),
					).toBe(false);
					results.push({
						writeDelayMs,
						statDelayMs,
						sample,
						readyMs,
						writeMs: written - sent,
						commitMs: ended - written,
						totalMs: ended - start,
					});
				} finally {
					await closeWebSocket(socket);
				}
			}
		}
		const statResponse = await fetch(`${ssh.controlUrl}/sftp/stat-delay`);
		expect(statResponse.ok).toBe(true);
		const statStats = await statResponse.json();
		if (commitProfile) expect(statStats.sftpDelayedStatCount).toBeGreaterThanOrEqual(profileSampleCount);
		console.log('UPLOAD_STAT_PROFILE', JSON.stringify(statStats));
		console.log('SMALL_UPLOAD_RESULT', JSON.stringify(results));
		await writeFile(path.join(ssh.directory, 'small-upload-profile.json'), JSON.stringify(results, null, 2));
	} finally {
		try {
			expect((await fetch(`${ssh.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' })).ok).toBe(true);
		} finally {
			try {
				expect((await fetch(`${ssh.controlUrl}/sftp/stat-delay?ms=0`, { method: 'POST' })).ok).toBe(true);
			} finally {
				await closeWebSocket(workspace.socket);
			}
		}
	}
});
