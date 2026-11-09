import { profileSampleCount } from '../../../../support/profile-samples';
import { readWorkspaceFileSearchResponse } from '../../../../../packages/shared/src/remote/files/workspace-codec';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { loginAsAdmin } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { createSshConnection } from '../../../../support/http/ssh-targets.ts';
import {
	closeWebSocket,
	requestWorkspace,
	waitForFilesystemReady,
} from '../../../../support/protocols/workspace-client';

test('measure recursive search on wide and deep trees under remote directory latency', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	const root = path.join(ssh.root, 'search-profile');
	const expected: Record<string, string[]> = { wide: [], deep: [], skew: [] };
	for (const shape of ['wide', 'deep', 'skew']) {
		for (let i = 0; i < 24; i++) {
			const relative = shape === 'wide' ? `d${i}` : Array.from({ length: i + 1 }, (_, n) => `d${n}`).join('/');
			await mkdir(path.join(root, shape, relative), { recursive: true });
			await writeFile(path.join(root, shape, relative, 'needle.txt'), 'search fixture');
			expected[shape].push(`${relative}/needle.txt`);
		}
	}
	await mkdir(path.join(root, 'skew', 'slow'), { recursive: true });
	await writeFile(path.join(root, 'skew', 'slow', 'needle.txt'), 'slow fixture');
	expected.skew.push('slow/needle.txt');
	const workspace = await httpClients.openWorkspace(await createSshConnection(request, ssh));
	const results = [];
	try {
		await waitForFilesystemReady(workspace.socket);
		for (const delay of [0, 20, 80]) {
			expect(
				(await fetch(`${ssh.controlUrl}/sftp/readdir-delay?ms=${delay}`, { method: 'POST' })).ok,
			).toBeTruthy();
			for (const shape of ['wide', 'deep', 'skew']) {
				expect(
					(
						await fetch(
							`${ssh.controlUrl}/sftp/slow-directory?path=%2Fsearch-profile%2Fskew%2Fslow&ms=${shape === 'skew' ? 1500 : 0}`,
							{ method: 'POST' },
						)
					).ok,
				).toBeTruthy();
				for (let sample = 0; sample < profileSampleCount; sample++) {
					const beforeResponse = await fetch(`${ssh.controlUrl}/sftp/readdir-delay`);
					expect(beforeResponse.ok).toBe(true);
					const before = await beforeResponse.json();
					const start = performance.now();
					const response = await requestWorkspace<{
						truncated: boolean;
						entries: Array<{ relativePath: string }>;
					}>(workspace.socket, 'filesystem.search', { path: `/search-profile/${shape}`, query: 'needle' });
					const ms = performance.now() - start;
					expect(response.truncated).toBe(false);
					expect(response.entries.map((entry) => entry.relativePath).sort()).toEqual(
						[...expected[shape]].sort(),
					);
					const afterResponse = await fetch(`${ssh.controlUrl}/sftp/readdir-delay`);
					expect(afterResponse.ok).toBe(true);
					const after = await afterResponse.json();
					const delayedOpens = after.sftpDelayedDirectoryOpens - before.sftpDelayedDirectoryOpens;
					expect(delayedOpens).toBe(delay ? (shape === 'skew' ? 26 : 25) : 0);
					results.push({ delay, shape, sample, ms, delayedOpens });
				}
			}
		}
		console.log('SEARCH_NETWORK_RESULT', JSON.stringify(results));
		expect((await fetch(`${ssh.controlUrl}/sftp/slow-directory?ms=0`, { method: 'POST' })).ok).toBeTruthy();
		expect((await fetch(`${ssh.controlUrl}/sftp/readdir-delay?ms=0`, { method: 'POST' })).ok).toBeTruthy();
		const bounded = path.join(root, 'bounded');
		await mkdir(bounded, { recursive: true });
		await Promise.all(
			Array.from({ length: 510 }, (_, index) =>
				writeFile(path.join(bounded, `needle-${index}.txt`), 'bounded search'),
			),
		);
		const complete = readWorkspaceFileSearchResponse(
			await requestWorkspace(workspace.socket, 'filesystem.search', {
				path: '/search-profile/bounded',
				query: 'needle',
			}),
		);
		expect(complete.truncated).toBe(false);
		expect(complete.entries).toHaveLength(510);
		expect(new Set(complete.entries.map((entry) => entry.path)).size).toBe(510);
		expect(complete.entries.every((entry) => entry.path.startsWith('/search-profile/bounded/needle-'))).toBe(true);
		await expect(
			requestWorkspace(workspace.socket, 'filesystem.search', {
				path: '/search-profile/missing',
				query: 'needle',
			}),
		).rejects.toThrow();
		const recovered = await requestWorkspace<{ truncated: boolean; entries: Array<{ relativePath: string }> }>(
			workspace.socket,
			'filesystem.search',
			{ path: '/search-profile/wide', query: 'needle' },
		);
		expect(recovered.truncated).toBe(false);
		expect(recovered.entries.map((entry) => entry.relativePath).sort()).toEqual([...expected.wide].sort());
		await writeFile(path.join(ssh.directory, 'search-network-results.json'), JSON.stringify(results, null, 2));
	} finally {
		try {
			expect((await fetch(`${ssh.controlUrl}/sftp/slow-directory?ms=0`, { method: 'POST' })).ok).toBe(true);
		} finally {
			try {
				expect((await fetch(`${ssh.controlUrl}/sftp/readdir-delay?ms=0`, { method: 'POST' })).ok).toBe(true);
			} finally {
				await closeWebSocket(workspace.socket);
			}
		}
	}
});
