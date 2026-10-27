import { expect, test } from '../../support/fixtures';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readWorkspaceFileListResponse } from '../../../../packages/shared/src/remote/files/workspace-codec';
import {
	readWorkspaceArchiveEvent,
	readWorkspaceCopyMoveEvent,
} from '../../../../packages/shared/src/remote/transfers/task-codec';
import type { WorkspaceArchiveEvent } from '../../../../packages/shared/src/remote/transfers/workspace';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection } from '../../support/ssh';
import {
	closeWebSocket,
	openWorkspaceSession,
	requestWorkspace,
	waitForFilesystemReady,
	waitForJson,
	type E2eWebSocket,
} from '../../support/ws';

function transferOutcome(socket: E2eWebSocket, type: string, requestId: string) {
	return waitForJson(
		socket,
		(message) =>
			message.type === type &&
			message.payload?.requestId === requestId &&
			['completed', 'failed', 'cancelled'].includes(message.payload?.type),
		120_000,
	).then((message) => message.payload);
}

test('large directories list, stream as ZIP and delete beyond the former twenty-thousand-entry limit', async ({
	request,
}, testInfo) => {
	test.setTimeout(240_000);
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const workspace = await openWorkspaceSession(request, connectionId);
	const name = 'capacity-' + crypto.randomUUID().slice(0, 8);
	const root = path.resolve('.tmp/ssh-root', name);
	const count = 20_005;
	try {
		await mkdir(root);
		for (let index = 0; index < count; index++) {
			await writeFile(path.join(root, String(index)), index === count - 1 ? 'last entry\n' : '');
		}
		await waitForFilesystemReady(workspace.socket);
		const listing = readWorkspaceFileListResponse(
			await requestWorkspace(workspace.socket, 'filesystem.list', { path: '/' + name }, undefined, 60_000),
		);
		expect(listing.entries).toHaveLength(count);
		expect(listing.entries.find((entry) => entry.name === String(count - 1))?.metadata).toMatchObject({
			size: 11,
			isFile: true,
		});
		const query = new URLSearchParams({
			connectionId: String(connectionId),
			sessionId: workspace.workspaceId,
			remotePath: '/' + name,
		});
		const response = await request.get('/api/v1/sftp/download-directory?' + query, { timeout: 120_000 });
		try {
			expect(response.status()).toBe(200);
			const archive = testInfo.outputPath('large-directory.zip');
			await writeFile(archive, await response.body());
			const listing = await promisify(execFile)('unzip', ['-Z1', archive]);
			expect(listing.stdout.trim().split('\n')).toHaveLength(count);
			const content = await promisify(execFile)('unzip', ['-p', archive, String(count - 1)]);
			expect(content.stdout).toBe('last entry\n');
		} finally {
			await response.dispose();
		}
		await requestWorkspace(workspace.socket, 'filesystem.remove', { paths: ['/' + name] }, undefined, 120_000);
		await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
	} finally {
		await closeWebSocket(workspace.socket);
	}
});

test('copy, extract, directory download and recursive delete accept a seventy-level tree and sixty-five sources', async ({
	request,
}, testInfo) => {
	test.setTimeout(180_000);
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const workspace = await openWorkspaceSession(request, connectionId);
	const name = 'deep-' + crypto.randomUUID().slice(0, 8);
	const root = path.resolve('.tmp/ssh-root', name);
	const nested = Array.from({ length: 70 }, () => 'd');
	const content = 'seventy levels remain usable\n';
	try {
		await mkdir(path.join(root, 'source', ...nested), { recursive: true });
		await mkdir(path.join(root, 'target'));
		await writeFile(path.join(root, 'source', ...nested, 'leaf.txt'), content);
		const sources = Array.from({ length: 64 }, (_, index) => `/${name}/f${index}`);
		for (const source of sources) await writeFile(path.resolve('.tmp/ssh-root', source.slice(1)), source);
		sources.push(`/${name}/source`);
		await waitForFilesystemReady(workspace.socket);
		const copyId = crypto.randomUUID();
		const copied = transferOutcome(workspace.socket, 'transfer.copyMove', copyId);
		await requestWorkspace(
			workspace.socket,
			'transfer.copyMove',
			{ mode: 'copy', sources, destination: `/${name}/target` },
			copyId,
		);
		const result = readWorkspaceCopyMoveEvent(await copied);
		expect(result).toMatchObject({ type: 'completed', mode: 'copy' });
		if (result.type !== 'completed') throw new Error('Copy did not complete');
		expect(result.items).toHaveLength(65);
		expect(await readFile(path.join(root, 'target', 'source', ...nested, 'leaf.txt'), 'utf8')).toBe(content);
		for (const source of sources.slice(0, 64))
			expect(await readFile(path.join(root, 'target', path.posix.basename(source)), 'utf8')).toBe(source);
		const archiveId = crypto.randomUUID();
		const archiveProgress: Extract<WorkspaceArchiveEvent, { type: 'progress' }>[] = [];
		const archived = waitForJson(
			workspace.socket,
			(message) => {
				if (message.type !== 'transfer.archive' || message.payload?.requestId !== archiveId) return false;
				const event = readWorkspaceArchiveEvent(message.payload);
				if (event.type === 'progress') archiveProgress.push(event);
				return event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled';
			},
			120_000,
		).then((message) => message.payload);
		await requestWorkspace(
			workspace.socket,
			'transfer.compress',
			{ sources, destination: `/${name}/selected.zip`, format: 'zip' },
			archiveId,
		);
		expect(await archived).toMatchObject({ type: 'completed' });
		const liveProgress = archiveProgress.filter((event) => (event.percent ?? 0) > 0 && (event.percent ?? 0) < 100);
		expect(new Set(liveProgress.map((event) => event.percent)).size).toBeGreaterThan(1);
		const finalProgress = archiveProgress.at(-1);
		const expectedEntries = sources.length + nested.length + 1;
		expect(finalProgress).toMatchObject({ percent: 100, fileCount: expectedEntries, totalFiles: expectedEntries });
		let previousPercent = 0;
		for (const event of archiveProgress) {
			expect(event.percent).toBeGreaterThanOrEqual(previousPercent);
			previousPercent = event.percent ?? 0;
		}
		for (const event of liveProgress) {
			expect(event.totalFiles).toBe(expectedEntries);
			expect(event.fileCount).toBeGreaterThan(0);
			expect(event.fileCount).toBeLessThanOrEqual(expectedEntries);
		}
		expect(archiveProgress.slice(0, -1).some((event) => event.percent === 100)).toBe(false);
		await requestWorkspace(workspace.socket, 'filesystem.remove', { paths: sources }, undefined, 60_000);
		const extractId = crypto.randomUUID();
		const extracted = transferOutcome(workspace.socket, 'transfer.archive', extractId);
		await requestWorkspace(workspace.socket, 'transfer.decompress', { source: `/${name}/selected.zip` }, extractId);
		expect(await extracted).toMatchObject({ type: 'completed' });
		expect(await readFile(path.join(root, 'source', ...nested, 'leaf.txt'), 'utf8')).toBe(content);
		const query = new URLSearchParams({
			connectionId: String(connectionId),
			sessionId: workspace.workspaceId,
			remotePath: `/${name}/source`,
		});
		const response = await request.get('/api/v1/sftp/download-directory?' + query);
		try {
			expect(response.status()).toBe(200);
			const archive = testInfo.outputPath('deep-directory.zip');
			await writeFile(archive, await response.body());
			const downloaded = await promisify(execFile)('unzip', ['-p', archive, [...nested, 'leaf.txt'].join('/')]);
			expect(downloaded.stdout).toBe(content);
		} finally {
			await response.dispose();
		}
		await requestWorkspace(workspace.socket, 'filesystem.remove', { paths: ['/' + name] }, undefined, 60_000);
		await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
	} finally {
		await closeWebSocket(workspace.socket);
	}
});

test('more than sixteen archive tasks queue and all complete without capacity rejection', async ({ request }) => {
	test.setTimeout(120_000);
	await loginAsInitialAdmin(request);
	const workspace = await openWorkspaceSession(request, await ensureTestSshConnection(request));
	try {
		await waitForFilesystemReady(workspace.socket);
		const ids = Array.from({ length: 20 }, () => crypto.randomUUID());
		const outcomes = ids.map((id) => transferOutcome(workspace.socket, 'transfer.archive', id));
		await Promise.all(
			ids.map((id) =>
				requestWorkspace(
					workspace.socket,
					'transfer.compress',
					{
						sources: ['/archive-source.txt'],
						destination: `/queued-${id}.zip`,
						format: 'zip',
					},
					id,
				),
			),
		);
		const results = await Promise.all(outcomes);
		for (const [index, result] of results.entries()) {
			expect(result).toMatchObject({ type: 'completed', requestId: ids[index] });
			const bytes = await promisify(execFile)('unzip', [
				'-p',
				path.resolve('.tmp/ssh-root', `queued-${ids[index]}.zip`),
			]);
			expect(bytes.stdout).toBe(await readFile('.tmp/ssh-root/archive-source.txt', 'utf8'));
		}
	} finally {
		await closeWebSocket(workspace.socket);
	}
});

test('nine overlapping downloads keep complete file content without a global eight-download rejection', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const workspace = await openWorkspaceSession(request, connectionId);
	const name = 'parallel-' + crypto.randomUUID().slice(0, 8) + '.bin';
	const bytes = Buffer.alloc(256 * 1024, 0x5b);
	const control = E2E_SSH.controlUrl + '/sftp/read-network';
	try {
		await writeFile(path.resolve('.tmp/ssh-root', name), bytes);
		await waitForFilesystemReady(workspace.socket);
		expect((await fetch(`${control}?ms=200&bytesPerSecond=0`, { method: 'POST' })).ok).toBe(true);
		const query = new URLSearchParams({
			connectionId: String(connectionId),
			sessionId: workspace.workspaceId,
			remotePath: '/' + name,
		});
		const results = await Promise.allSettled(
			Array.from({ length: 9 }, async () => {
				const response = await request.get('/api/v1/sftp/download?' + query);
				try {
					expect(response.status()).toBe(200);
					expect(await response.body()).toEqual(bytes);
				} finally {
					await response.dispose();
				}
			}),
		);
		for (const result of results)
			expect(result.status, result.status === 'rejected' ? String(result.reason) : '').toBe('fulfilled');
	} finally {
		await fetch(`${control}?ms=0&bytesPerSecond=0`, { method: 'POST' });
		await closeWebSocket(workspace.socket);
	}
});

test('sparse TAR larger than sixty-four GiB extracts without an arbitrary expanded-size rejection', async ({
	request,
}) => {
	test.setTimeout(120_000);
	await loginAsInitialAdmin(request);
	const workspace = await openWorkspaceSession(request, await ensureTestSshConnection(request));
	const name = 'sparse-' + crypto.randomUUID().slice(0, 8);
	const root = path.resolve('.tmp/ssh-root', name);
	const file = path.join(root, 'large.bin');
	const size = 64 * 1024 * 1024 * 1024 + 1;
	const fs = await import('node:fs/promises');
	try {
		await mkdir(root);
		const handle = await fs.open(file, 'w');
		try {
			await handle.truncate(size);
			await handle.write(Buffer.from('Z'), 0, 1, size - 1);
		} finally {
			await handle.close();
		}
		await promisify(execFile)('tar', [
			'--sparse',
			'--format=gnu',
			'-czf',
			path.join(root, 'large.tar.gz'),
			'-C',
			root,
			'large.bin',
		]);
		await fs.unlink(file);
		await waitForFilesystemReady(workspace.socket);
		const id = crypto.randomUUID();
		const extracted = transferOutcome(workspace.socket, 'transfer.archive', id);
		await requestWorkspace(workspace.socket, 'transfer.decompress', { source: `/${name}/large.tar.gz` }, id);
		expect(await extracted).toMatchObject({ type: 'completed' });
		const metadata = await stat(file);
		expect(metadata.size).toBe(size);
		// The fixture measures allocation as well: this must remain sparse, not
		// silently allocate 64 GiB merely to exercise the old numeric threshold.
		expect(metadata.blocks * 512).toBeLessThan(1024 * 1024);
		const restored = await fs.open(file, 'r');
		try {
			const tail = Buffer.alloc(1);
			expect((await restored.read(tail, 0, 1, size - 1)).bytesRead).toBe(1);
			expect(tail.toString()).toBe('Z');
		} finally {
			await restored.close();
		}
	} finally {
		await closeWebSocket(workspace.socket);
	}
});

for (const format of ['tar.gz', 'tar.bz2'] as const) {
	test(`${format} reports native byte progress for a single large file during compression and extraction`, async ({
		request,
	}) => {
		await loginAsInitialAdmin(request);
		const workspace = await openWorkspaceSession(request, await ensureTestSshConnection(request));
		const name = 'tar-progress-' + crypto.randomUUID().slice(0, 8);
		const root = path.resolve('.tmp/ssh-root', name);
		const bytes = Buffer.alloc(4 * 1024 * 1024, 0x7b);
		await mkdir(root);
		await writeFile(path.join(root, 'large.bin'), bytes);
		try {
			await waitForFilesystemReady(workspace.socket);
			for (const operation of ['compress', 'decompress'] as const) {
				const requestId = crypto.randomUUID();
				const events: Extract<WorkspaceArchiveEvent, { type: 'progress' }>[] = [];
				const done = waitForJson(
					workspace.socket,
					(message) => {
						if (message.type !== 'transfer.archive' || message.payload?.requestId !== requestId)
							return false;
						const event = readWorkspaceArchiveEvent(message.payload);
						if (event.type === 'progress') events.push(event);
						return event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled';
					},
					60_000,
				);
				await requestWorkspace(
					workspace.socket,
					'transfer.' + operation,
					operation === 'compress'
						? { sources: [`/${name}/large.bin`], destination: `/${name}/large.${format}`, format }
						: { source: `/${name}/large.${format}` },
					requestId,
				);
				expect((await done).payload).toMatchObject({ type: 'completed' });
				const native = events.filter((event) => event.processedBytes !== undefined);
				expect(native.length).toBeGreaterThan(1);
				let previous = 0;
				for (const event of native) {
					expect(event.processedBytes).toBeGreaterThan(previous);
					previous = event.processedBytes ?? 0;
					expect(event.percent).not.toBe(100);
				}
				expect(events.at(-1)).toMatchObject({ percent: 100, fileCount: 1, totalFiles: 1 });
				expect(events.slice(0, -1).some((event) => event.percent === 100)).toBe(false);
				expect(await readFile(path.join(root, 'large.bin'))).toEqual(bytes);
				if (operation === 'compress') {
					await requestWorkspace(workspace.socket, 'filesystem.remove', { paths: [`/${name}/large.bin`] });
				}
			}
		} finally {
			await closeWebSocket(workspace.socket);
		}
	});
}
