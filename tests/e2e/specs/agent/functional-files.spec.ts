import { agentChatSurface } from '../../fixtures/agent/workbench';
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import {
	prepareNativeTask,
	openNativeTask,
	openNativeTaskPanel,
	startNativeTask,
	finishNativeTask,
	readNativeRun,
	cancelNativeTask,
} from '../../fixtures/agent/native-task';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import { digest } from './functional-regressions.helpers';

test.use({ actionTimeout: 10_000 });

test('SSH file lifecycle binds mutations to hashes and fingerprints and rejects mismatched patch context', async ({
	request,
	page,
}) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const task = await prepareNativeTask(request, page, ['file.read', 'file.write', 'file.delete'], [connectionId]);
	const project = path.resolve(__dirname, '../../.tmp/ssh-root/file-lifecycle');
	const preserved = '{"business":"keep","version":1}\n';
	await mkdir(project);
	await writeFile(path.join(project, 'preserved.json'), preserved);
	let runId: string | undefined;
	try {
		await openNativeTask(task);
		const run = await startNativeTask(task, `E2E_FILE_LIFECYCLE connection=${connectionId}`, [connectionId]);
		runId = run.id;
		const result = await finishNativeTask(task, run.id, ['file_write', 'file_patch', 'file_move', 'file_delete']);
		expect(result.run.status).toBe('completed');
		const report = JSON.parse(result.text);
		expect(report.patched).toMatchObject({ text: 'ALPHA\nkeep\n', sha256: digest('ALPHA\nkeep\n') });
		expect(report.moved).toMatchObject({ path: '/file-lifecycle/moved.txt', sha256: report.patched.sha256 });
		expect(report.remaining.entries.map((entry: { name: string }) => entry.name)).toEqual(['preserved.json']);
		expect(report.preserved).toMatchObject({ text: preserved, sha256: digest(preserved) });
		const rejected = await startNativeTask(task, `E2E_FILE_PATCH_REJECT connection=${connectionId}`, [
			connectionId,
		]);
		runId = rejected.id;
		expect((await finishNativeTask(task, rejected.id, ['file_patch'])).run.status).toBe('unknown');
		expect(await readdir(project)).toEqual(['preserved.json']);
		expect(await readFile(path.join(project, 'preserved.json'), 'utf8')).toBe(preserved);
	} finally {
		if (runId) {
			await cancelNativeTask(task, runId);
		}
		await rm(project, { recursive: true, force: true });
	}
});

for (const repeat of [false, true]) {
	test(`SSH file search cancellation closes held reads and supports ${repeat ? 'a repeated Run' : 'a new App'} recovery`, async ({
		request,
		page,
	}) => {
		await loginAsInitialAdmin(request);
		const connectionId = await ensureTestSshConnection(request);
		const task = await prepareNativeTask(request, page, ['file.read'], [connectionId]);
		const project = path.resolve(__dirname, '../../.tmp/ssh-root/search-scan');
		await mkdir(project);
		await writeFile(path.join(project, 'sentinel.txt'), 'SCAN_SENTINEL\n');
		const hold = E2E_URLS.sshControlOrigin + '/sftp/read-hold';
		let runId: string | undefined;
		try {
			expect((await request.post(hold + '?blocked=1')).ok()).toBe(true);
			await openNativeTask(task);
			const run = await startNativeTask(task, `E2E_SEARCH_SCAN connection=${connectionId}`, [connectionId]);
			runId = run.id;
			await expect.poll(async () => (await (await request.get(hold)).json()).pending).toBeGreaterThan(0);
			await openNativeTaskPanel(page);
			await agentChatSurface(page).getByRole('button', { name: 'Request cancellation', exact: true }).click();
			await expect.poll(async () => (await readNativeRun(task, run.id)).status).toBe('cancelled');
			await expect.poll(async () => (await (await request.get(hold)).json()).pending).toBe(0);
			expect((await (await request.get(hold)).json()).blocked).toBe(true);
			await expect
				.poll(async () => {
					const handles = await (await request.get(E2E_URLS.sshControlOrigin + '/sftp/read-handles')).json();
					return handles.opened - handles.closed;
				})
				.toBe(0);
			expect((await request.post(hold + '?blocked=0')).ok()).toBe(true);
			const recovery = repeat ? task : await prepareNativeTask(request, page, ['file.read'], [connectionId]);
			await openNativeTask(recovery);
			const next = await startNativeTask(recovery, `E2E_SEARCH_SCAN connection=${connectionId}`, [connectionId]);
			const result = await finishNativeTask(recovery, next.id);
			expect(result.run.status).toBe('completed');
			expect(JSON.parse(result.text)).toMatchObject({
				matches: [{ path: '/search-scan/sentinel.txt', line: 1, text: 'SCAN_SENTINEL' }],
				truncated: false,
			});
			expect((await request.get(E2E_URLS.sshControlOrigin + '/health')).ok()).toBe(true);
		} finally {
			expect((await request.post(hold + '?blocked=0')).ok()).toBe(true);
			if (runId) {
				await cancelNativeTask(task, runId);
			}
			await rm(project, { recursive: true, force: true });
		}
	});
}

test('SSH file search traverses deep directories without changing the matching file', async ({ request, page }) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const task = await prepareNativeTask(request, page, ['file.read'], [connectionId]);
	const project = path.resolve(__dirname, '../../.tmp/ssh-root/search-scan');
	const leaf = path.join(project, ...Array.from({ length: 96 }, () => 'nested'), 'sentinel.txt');
	await mkdir(path.dirname(leaf), { recursive: true });
	await writeFile(leaf, 'SCAN_SENTINEL\n');
	let runId: string | undefined;
	try {
		await openNativeTask(task);
		const created = await startNativeTask(task, `E2E_SEARCH_SCAN connection=${connectionId}`, [connectionId]);
		runId = created.id;
		const result = await finishNativeTask(task, created.id);
		expect(result.run.status).toBe('completed');
		expect(JSON.parse(result.text)).toEqual({
			matches: [
				{
					path: '/search-scan/' + path.relative(project, leaf),
					line: 1,
					text: 'SCAN_SENTINEL',
					column: 1,
					queryIndex: 0,
				},
			],
			truncated: false,
		});
		expect(await readFile(leaf, 'utf8')).toBe('SCAN_SENTINEL\n');
	} finally {
		if (runId) {
			await cancelNativeTask(task, runId);
		}
		await rm(project, { recursive: true, force: true });
	}
});

test('SSH search traverses complete file content and never follows a symlink to the sentinel', async ({
	request,
	page,
}) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const task = await prepareNativeTask(request, page, ['file.read'], [connectionId]);
	const project = path.resolve(__dirname, '../../.tmp/ssh-root/search-scan');
	await mkdir(project);
	let runId: string | undefined;

	try {
		for (let index = 0; index < 101; index++) {
			await writeFile(path.join(project, 'a-' + String(index).padStart(3, '0') + '.txt'), 'nothing\n');
		}
		await openNativeTask(task);
		const bounded = await startNativeTask(task, `E2E_SEARCH_SCAN connection=${connectionId}`, [connectionId]);
		runId = bounded.id;
		const complete = await finishNativeTask(task, bounded.id);
		expect(complete.run.status).toBe('completed');
		expect(JSON.parse(complete.text)).toEqual({ matches: [], truncated: false });
		await rm(project, { recursive: true });
		await mkdir(project);
		await writeFile(path.join(project, 'oversized.txt'), 'x'.repeat(32769) + '\nSCAN_SENTINEL\n');
		const oversized = await startNativeTask(task, `E2E_SEARCH_SCAN connection=${connectionId}`, [connectionId]);
		runId = oversized.id;
		const large = await finishNativeTask(task, oversized.id);
		expect(large.run.status).toBe('completed');
		expect(JSON.parse(large.text)).toEqual({
			matches: [{ path: '/search-scan/oversized.txt', line: 2, column: 1, queryIndex: 0, text: 'SCAN_SENTINEL' }],
			truncated: false,
		});
		expect(await readFile(path.join(project, 'oversized.txt'), 'utf8')).toBe(
			'x'.repeat(32769) + '\nSCAN_SENTINEL\n',
		);
		await rm(path.join(project, 'oversized.txt'));
		const external = path.join(path.dirname(project), 'external-sentinel.txt');
		await writeFile(external, 'SCAN_SENTINEL\n');
		try {
			await symlink(external, path.join(project, 'sentinel-link'));
			const linked = await startNativeTask(task, `E2E_SEARCH_SCAN connection=${connectionId}`, [connectionId]);
			runId = linked.id;
			const result = await finishNativeTask(task, linked.id);
			expect(result.run.status).toBe('completed');
			expect(JSON.parse(result.text)).toEqual({ matches: [], truncated: false });
			expect(await readFile(external, 'utf8')).toBe('SCAN_SENTINEL\n');
		} finally {
			await rm(external, { force: true });
		}
	} finally {
		if (runId) {
			await cancelNativeTask(task, runId);
		}
		await rm(project, { recursive: true, force: true });
	}
});
