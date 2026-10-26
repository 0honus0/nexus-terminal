import { randomUUID, createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import regressionInputs from '../../fixtures/agent/regression-inputs.json';
import { expect, test } from '../../support/fixtures';
import {
	prepareNativeTask,
	openNativeTask,
	openNativeTaskPanel,
	startNativeTask,
	finishNativeTask,
	readNativeRun,
	waitNativeApproval,
	resolveNativeApproval,
	cancelNativeTask,
} from '../../fixtures/agent/native-task';
import { requestAgentJson, requestAgentWorkspace } from '../../support/agent';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection } from '../../support/ssh';
import { installTestPlugin } from '../../support/plugins';
import { E2E_URLS } from '../../support/test-env';
import { readAgentProviderView } from '../../../../packages/shared/src/agent/providers/http-codec';
import { readAgentAppResponse } from '../../../../packages/shared/src/agent/scope/http-codec';
import {
	readAgentMemoryListResponse,
	readAgentMemoryResponse,
} from '../../../../packages/shared/src/agent/memory/http-codec';
import { readAgentErrorResponse, readAgentId } from '../../../../packages/shared/src/agent/http-codec';
import { readAgentThreadToolsResponse } from '../../../../packages/shared/src/agent/tools/http-codec';
import { readAgentBrowserConfiguration } from '../../../../packages/shared/src/agent/integrations/browser-http-codec';

test.use({ actionTimeout: 10_000 });

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

const tcpPortOpen = (port: number): Promise<boolean> =>
	new Promise((resolve) => {
		const socket = net.connect({ host: '127.0.0.1', port });

		const finish = (open: boolean) => {
			socket.destroy();
			resolve(open);
		};

		socket.once('connect', () => finish(true));
		socket.once('error', () => finish(false));
		socket.setTimeout(1_000, () => finish(false));
	});

const processGone = async (pid: number) => {
	expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
	try {
		await readFile(`/proc/${pid}/cmdline`);
		return false;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return true;
		}
		throw error;
	}
};

const listenerPid = async (port: number): Promise<number | null> => {
	const localAddress = `0100007F:${port.toString(16).toUpperCase().padStart(4, '0')}`;
	const tcp = await readFile('/proc/net/tcp', 'utf8');
	const inode = tcp
		.split('\n')
		.map((line) => line.trim().split(/\s+/))
		.find((fields) => fields[1] === localAddress && fields[3] === '0A')?.[9];
	if (!inode) {
		return null;
	}
	for (const entry of await readdir('/proc')) {
		if (!/^\d+$/.test(entry)) {
			continue;
		}
		let descriptors: string[];
		try {
			descriptors = await readdir(`/proc/${entry}/fd`);
		} catch {
			continue;
		}
		for (const descriptor of descriptors) {
			try {
				if ((await readlink(`/proc/${entry}/fd/${descriptor}`)) === `socket:[${inode}]`) {
					return Number(entry);
				}
			} catch {
				/* A process may close a descriptor during this read. */
			}
		}
	}
	return null;
};

test('A08 denied deployment cannot execute the proposed SSH mutation', async ({ request, page }) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const task = await prepareNativeTask(request, page, ['shell.execute'], [connectionId]);
	await openNativeTask(task);
	const created = await startNativeTask(task, `E2E_BLOCKED_DEPLOY connection=${connectionId}`, [connectionId]);
	const approval = await waitNativeApproval(task, created.id, 'shell_execute');
	await expect(readFile(path.resolve(__dirname, '../../.tmp/ssh-root/blocked-deploy.txt'))).rejects.toMatchObject({
		code: 'ENOENT',
	});
	await resolveNativeApproval(task, approval, 'denied');
	const result = await finishNativeTask(task, created.id);
	expect(result.run.status).toBe('failed');
	expect(result.text).toBe('');
	await expect(readFile(path.resolve(__dirname, '../../.tmp/ssh-root/blocked-deploy.txt'))).rejects.toMatchObject({
		code: 'ENOENT',
	});
});

test('A07 browser rejects a stale click, then a separate approved Run deploys once and delivers a readable PNG Artifact', async ({
	request,
	page,
}) => {
	const task = await prepareNativeTask(request, page, ['browser.read', 'browser.interact', 'artifacts.read']);
	const configuration = await requestAgentJson(
		request,
		{ method: 'GET', path: '/browser/configuration' },
		readAgentBrowserConfiguration,
	);
	const saved = await requestAgentJson(
		request,
		{
			method: 'PUT',
			path: '/browser/configuration',
			data: {
				expectedVersion: configuration.version,
				targets: [
					{
						id: 'e2e-deployment',
						endpoints: [
							{ url: E2E_URLS.browserCdpEndpoint, priority: 1, allowPlaintext: true, verifyTls: true },
						],
						// Browser's URL gate is exact-path by default. The fixture page
						// loads /state and its approved button POSTs /deploy; without
						// explicit paths CDP blocks both while a script-text snapshot can
						// misleadingly contain the expected words.
						allowedUrlPatterns: [
							E2E_URLS.deploymentPageOrigin + '/',
							E2E_URLS.deploymentPageOrigin + '/state',
							E2E_URLS.deploymentPageOrigin + '/deploy',
						],
					},
				],
			},
		},
		readAgentBrowserConfiguration,
	);

	const contexts = async () =>
		(await (await fetch(E2E_URLS.browserControlOrigin + '/contexts')).json()).browserContextIds;

	const state = async () => {
		const response = await fetch(E2E_URLS.deploymentPageOrigin + '/state');
		expect(response.ok).toBe(true);
		return response.json();
	};

	const baseline = await contexts();
	expect(await state()).toEqual({ deployed: false, deployments: 0, release: 'fixture-v1' });
	await openNativeTask(task);
	const marker = `E2E_BROWSER_DEPLOY version=${saved.version} url=${E2E_URLS.deploymentPageOrigin}/`;
	const stale = await startNativeTask(task, marker + ' stale=true');
	const rejected = await finishNativeTask(task, stale.id, ['browser_open', 'browser_navigate', 'browser_click']);
	expect(rejected.run.status).toBe('unknown');
	expect(await state()).toEqual({ deployed: false, deployments: 0, release: 'fixture-v1' });
	await expect.poll(contexts).toEqual(baseline);
	// Explicitly release the unknown Run; a new intent must not bypass its active-thread fence.
	await cancelNativeTask(task, stale.id);
	// Cancellation above is performed by the separately authenticated API
	// context. Reopen the Hub and read the newly settled thread before
	// submitting the next user intent; an already-mounted composer can still
	// display the prior active-run view until that explicit refresh.
	await openNativeTask(task);
	const created = await startNativeTask(task, marker);
	const result = await finishNativeTask(task, created.id, [
		'browser_open',
		'browser_navigate',
		'browser_click',
		'browser_close',
	]);
	expect(result.run.status).toBe('completed');
	const report = JSON.parse(result.text);
	expect(JSON.stringify(report.page.nodes)).toContain('Deployed fixture-v1');
	expect(report.closed).toEqual({ status: 'closed' });
	expect(await state()).toEqual({ deployed: true, deployments: 1, release: 'fixture-v1' });
	const artifact = report.capture;
	readAgentId(artifact.artifactId);
	const download = await request.get(`/api/v1/agent/apps/${task.app.id}/artifacts/${artifact.artifactId}/content`);
	expect(download.status()).toBe(200);
	expect(download.headers()['content-type']).toContain('application/octet-stream');
	const bytes = await download.body();
	expect(bytes.length).toBe(artifact.sizeBytes);
	expect(digest(bytes)).toBe(artifact.sha256);
	expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
	const dimensions = await page.evaluate(async (base64) => {
		const image = new Image();
		image.src = 'data:image/png;base64,' + base64;
		await image.decode();
		return { width: image.naturalWidth, height: image.naturalHeight };
	}, bytes.toString('base64'));
	expect(dimensions.width).toBeGreaterThan(0);
	expect(dimensions.height).toBeGreaterThan(0);
	await expect.poll(contexts).toEqual(baseline);
});

test('A06 retired Workspace APIs and environment fields stay rejected while current Runs remain available', async ({
	request,
	page,
}) => {
	const task = await prepareNativeTask(request, page);
	for (const endpoint of [
		'/api/v1/agent/workspace-runtime/availability',
		'/api/v1/agent/workspace-runtime/catalog',
		'/api/v1/apps/nexus.agent/workspaces',
	]) {
		expect((await request.get(endpoint)).status()).toBe(404);
	}
	for (const environment of [
		null,
		{ recipeId: 'workspace-dev', versions: { 'base-tools': '1' }, catalogRevision: 'old' },
	]) {
		const rejected = await request.post(`/api/v1/agent/apps/${task.app.id}/threads/${task.thread.id}/runs`, {
			headers: { Origin: E2E_URLS.frontendOrigin, 'Idempotency-Key': randomUUID() },
			data: { ...task.input, environment },
		});
		expect(rejected.status()).toBe(400);
		expect(readAgentErrorResponse(await rejected.json()).code).toBe('invalid_input');
	}
	const runs = await requestAgentWorkspace(request, task.app, {
		method: 'agent.runs.list',
		params: { threadId: task.thread.id, after: 0, limit: 20 },
	});
	if (runs.method !== 'agent.runs.list') {
		throw new Error('Unexpected Runs');
	}
	expect(runs.value.items).toEqual([]);
	await openNativeTask(task);
	const created = await startNativeTask(task, 'E2E_NO_WORKSPACE_TOOLS');
	expect((await finishNativeTask(task, created.id)).run.status).toBe('completed');
});

for (const signedSkill of [false, true]) {
	test(`${signedSkill ? 'A05 signed Operations Skill' : 'A04 bounded API'} deployment exposes real endpoints and releases its Run-owned process`, async ({
		request,
		page,
	}) => {
		await loginAsInitialAdmin(request);
		const connectionId = await ensureTestSshConnection(request);
		const plugin = signedSkill ? await installTestPlugin(request, 'nexus.agent') : null;
		const app = plugin
			? await requestAgentJson(request, { method: 'GET', path: `/apps/${plugin.appId}` }, readAgentAppResponse)
			: undefined;
		const task = await prepareNativeTask(
			request,
			page,
			signedSkill ? ['shell.execute', 'context.read'] : ['shell.execute'],
			[connectionId],
			app,
		);
		const portOwner = net.createServer();
		await new Promise<void>((resolve) => portOwner.listen(0, '127.0.0.1', resolve));
		const address = portOwner.address();
		if (!address || typeof address === 'string') {
			throw new Error('Missing ephemeral port');
		}
		const port = address.port;
		await new Promise<void>((resolve, reject) => portOwner.close((error) => (error ? reject(error) : resolve())));
		const project = path.resolve(__dirname, '../../.tmp/ssh-root/deploy-api');
		await cp(path.resolve(__dirname, '../../fixtures/agent/task-projects/startup-failure'), project, {
			recursive: true,
		});
		await writeFile(path.join(project, 'config.json'), '{ "catalogPath": "data/catalog.json" }\n');
		const files = (await readdir(project, { recursive: true })).filter((name) => name !== 'data');
		const baseline = new Map(
			await Promise.all(files.map(async (name) => [name, await readFile(path.join(project, name))] as const)),
		);
		let runId: string | undefined;
		let pid: number | null = null;
		try {
			await openNativeTask(task);
			const run = await startNativeTask(
				task,
				`E2E_DEPLOY_API connection=${connectionId} port=${port}${signedSkill ? ' E2E_OPERATIONS_SKILL' : ''}`,
				[connectionId],
			);
			runId = run.id;
			const launch = await waitNativeApproval(task, run.id, 'shell_execute');
			await resolveNativeApproval(task, launch, 'approved');
			await expect.poll(() => tcpPortOpen(port)).toBe(true);
			pid = await listenerPid(port);
			expect(pid).not.toBeNull();
			if (pid === null) {
				throw new Error('Live listener has no process');
			}
			expect(await readlink(`/proc/${pid}/cwd`)).toBe(project);
			expect((await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0')).toContain(`PORT=${port}`);
			for (const endpoint of ['health', 'catalog']) {
				const response = await fetch(`http://127.0.0.1:${port}/${endpoint}`);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual(
					endpoint === 'health'
						? { status: 'ok' }
						: JSON.parse(baseline.get('data/catalog.json')!.toString()),
				);
			}
			// This live background Job owns the target mutation claim until its
			// process exits. Sending another Agent shell mutation against the same
			// machine correctly conflicts; prove health/catalog from the separate
			// test owner above and end the exact observed HTTP process here.
			const shutdown = await fetch(`http://127.0.0.1:${port}/shutdown`, { method: 'POST' });
			expect(shutdown.status).toBe(200);
			expect(await shutdown.json()).toEqual({ stopping: true });
			await expect.poll(() => tcpPortOpen(port)).toBe(false);
			await expect.poll(() => processGone(pid!)).toBe(true);
			const result = await finishNativeTask(task, run.id);
			expect(result.run.status).toBe('completed');
			const report = JSON.parse(result.text);
			expect(report.launch.accepted).toBe(true);
			readAgentId(report.launch.jobId);
			expect(report.status.jobId).toBe(report.launch.jobId);
			expect(report.settled).toMatchObject({ jobId: report.launch.jobId, state: 'completed' });
			expect(report.settled.result).toMatchObject({ status: 'completed', exitCode: 0 });
			if (signedSkill) {
				expect(report.skill.name).toBe('operations');
				expect(report.skill.body).toContain('begin with bounded read-only inspection');
				expect(report.skill.body).toContain('Re-read authoritative state after a change');
			}
			await expect.poll(() => tcpPortOpen(port)).toBe(false);
			await expect.poll(() => processGone(pid!)).toBe(true);
			for (const [name, bytes] of baseline) {
				expect(await readFile(path.join(project, name))).toEqual(bytes);
			}
		} finally {
			if (runId) {
				await cancelNativeTask(task, runId);
			}
			await expect.poll(() => tcpPortOpen(port)).toBe(false);
			if (pid !== null) {
				const capturedPid = pid;
				await expect.poll(() => processGone(capturedPid)).toBe(true);
			}
			await rm(project, { recursive: true, force: true });
		}
	});
}

for (const scenario of [
	{
		id: 'B02',
		name: 'gateway 502',
		marker: 'E2E_GATEWAY_502',
		fixture: 'gateway-502',
		root: 'gateway-502',
		changed: 'config.json',
		from: 'upstream-wrong.sock',
		to: 'upstream.sock',
		before: '"requestId":"b02-health","status":502',
		after: 'Direct upstream and gateway health/catalog/404 verified',
	},
	{
		id: 'B01',
		name: 'API 500',
		marker: 'E2E_API_500_REPAIR',
		fixture: 'api-500',
		root: 'api-500',
		changed: 'server.mjs',
		from: 'catalog.products.map',
		to: 'catalog.items.map',
		before: '"requestId":"b01-request-one","status":500',
		after: 'HTTP health/catalog/404 verified',
	},
	{
		id: 'A03',
		name: 'build',
		marker: 'E2E_BUILD_REPAIR',
		fixture: 'build-failure',
		root: 'build-repair',
		changed: 'src/catalog.mjs',
		from: 'totalPrices',
		to: 'totalPrice',
		before: "does not provide an export named 'totalPrice'",
		after: 'Catalog verification passed.',
	},
]) {
	test(`${scenario.id} ${scenario.name} repair preserves original validation, data and physical process cleanup`, async ({
		request,
		page,
	}) => {
		await loginAsInitialAdmin(request);
		const connectionId = await ensureTestSshConnection(request);
		const task = await prepareNativeTask(
			request,
			page,
			['file.read', 'file.write', 'shell.execute'],
			[connectionId],
		);
		const fixture = path.resolve(__dirname, '../../fixtures/agent/task-projects', scenario.fixture);
		const project = path.resolve(__dirname, '../../.tmp/ssh-root', scenario.root);
		await cp(fixture, project, { recursive: true });
		const files = (await readdir(fixture, { recursive: true })).filter((name) => !['data', 'src'].includes(name));
		const baseline = new Map(
			await Promise.all(files.map(async (name) => [name, await readFile(path.join(fixture, name))] as const)),
		);
		let runId: string | undefined;
		try {
			await openNativeTask(task);
			const run = await startNativeTask(task, `${scenario.marker} connection=${connectionId}`, [connectionId]);
			runId = run.id;
			const result = await finishNativeTask(task, run.id, ['shell_execute', 'file_patch']);
			expect(result.run.status).toBe('completed');
			const report = JSON.parse(result.text);
			expect(report.before).toMatchObject({ status: 'nonzero', exitCode: 1 });
			expect(report.before.stdout + report.before.stderr).toContain(scenario.before);
			expect(report.after).toMatchObject({ status: 'completed', exitCode: 0 });
			expect(report.after.stdout).toContain(scenario.after);
			for (const output of [report.before.stdout, report.after.stdout]) {
				const identity = output.split('\n').find((line: string) => line.startsWith('{"serverPid":'));
				if (!identity) {
					expect(scenario.id).toBe('A03');
					continue;
				}
				const record = JSON.parse(identity);
				await expect.poll(() => processGone(record.serverPid)).toBe(true);
				expect(await tcpPortOpen(record.port)).toBe(false);
				if (record.socket) {
					await expect(readFile(record.socket)).rejects.toMatchObject({ code: 'ENOENT' });
				}
			}
			for (const [name, bytes] of baseline) {
				expect(await readFile(path.join(project, name))).toEqual(
					name === scenario.changed
						? Buffer.from(bytes.toString().replace(scenario.from, scenario.to))
						: bytes,
				);
			}
			expect(execFileSync(process.execPath, ['verify.mjs'], { cwd: project, encoding: 'utf8' })).toContain(
				scenario.after,
			);
		} finally {
			if (runId) {
				await cancelNativeTask(task, runId);
			}
			await rm(project, { recursive: true, force: true });
		}
	});
}

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
			await page.getByRole('button', { name: 'Request cancellation', exact: true }).click();
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

test('SSH file search rejects excessive depth without changing a deeply nested file', async ({ request, page }) => {
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
		expect((await finishNativeTask(task, created.id)).run.status).toBe('unknown');
		expect(await readFile(leaf, 'utf8')).toBe('SCAN_SENTINEL\n');
	} finally {
		if (runId) {
			await cancelNativeTask(task, runId);
		}
		await rm(project, { recursive: true, force: true });
	}
});

test('SSH search enforces file and byte bounds and never follows a symlink to the sentinel', async ({
	request,
	page,
}) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const task = await prepareNativeTask(request, page, ['file.read'], [connectionId]);
	const project = path.resolve(__dirname, '../../.tmp/ssh-root/search-scan');
	await mkdir(project);
	let runId: string | undefined;

	const cancelAndRefresh = async (id: string) => {
		await cancelNativeTask(task, id);
		// Reopen through the real workspace restore path after an external cancellation.
		await openNativeTask(task);
		const restored = await readNativeRun(task, id);
		expect(restored.id).toBe(id);
		expect(restored.status).toBe('cancelled');
		await expect(
			page.getByRole('dialog', { name: 'Agent', exact: true }).getByRole('button', { name: 'Send', exact: true }),
		).toBeVisible();
	};

	try {
		for (let index = 0; index < 101; index++) {
			await writeFile(path.join(project, 'a-' + String(index).padStart(3, '0') + '.txt'), 'nothing\n');
		}
		await openNativeTask(task);
		const bounded = await startNativeTask(task, `E2E_SEARCH_SCAN connection=${connectionId}`, [connectionId]);
		runId = bounded.id;
		expect((await finishNativeTask(task, bounded.id)).run.status).toBe('unknown');
		await cancelAndRefresh(bounded.id);
		await rm(project, { recursive: true });
		await mkdir(project);
		await writeFile(path.join(project, 'oversized.txt'), 'x'.repeat(32769));
		const oversized = await startNativeTask(task, `E2E_SEARCH_SCAN connection=${connectionId}`, [connectionId]);
		runId = oversized.id;
		expect((await finishNativeTask(task, oversized.id)).run.status).toBe('unknown');
		await cancelAndRefresh(oversized.id);
		expect((await readFile(path.join(project, 'oversized.txt'))).length).toBe(32769);
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

test('A01 read-only project handover reads real files without repairing or starting the application', async ({
	request,
	page,
}) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const task = await prepareNativeTask(request, page, ['file.read'], [connectionId]);
	const fixture = path.resolve(__dirname, '../../fixtures/agent/task-projects/startup-failure');
	const project = path.resolve(__dirname, '../../.tmp/ssh-root/task-a01');
	const files = ['AGENTS.md', 'README.md', 'package.json', 'config.json', 'server.mjs', 'data/catalog.json'];
	await cp(fixture, project, { recursive: true, errorOnExist: true, force: false });
	const hashes = await Promise.all(files.map(async (name) => digest(await readFile(path.join(project, name)))));
	let runId: string | undefined;
	try {
		await openNativeTask(task);
		const created = await startNativeTask(
			task,
			`E2E_TASK_A01_READONLY connection=${connectionId}: only read the project; do not repair or launch it.`,
			[connectionId],
		);
		runId = created.id;
		const result = await finishNativeTask(task, created.id);
		expect(result.run.status).toBe('completed');
		expect(JSON.parse(result.text)).toEqual({
			start: 'node server.mjs',
			configKey: 'catalogPath',
			configuredKey: 'catalogFile',
			requiredEnvironment: 'PORT',
			interfaces: ['/health', '/catalog'],
			serviceStarted: false,
			files: files.map((name, index) => ({ path: '/task-a01/' + name, sha256: hashes[index] })),
		});
		expect(await readdir(project)).toEqual(await readdir(fixture));
		for (const [index, name] of files.entries()) {
			expect(digest(await readFile(path.join(project, name)))).toBe(hashes[index]);
		}
	} finally {
		if (runId) {
			await cancelNativeTask(task, runId);
		}
		await rm(project, { recursive: true, force: true });
	}
});

test('read-only delivery keeps future repair outside the Run without executing tools', async ({ request, page }) => {
	const task = await prepareNativeTask(request, page);
	await openNativeTask(task);
	const run = await startNativeTask(
		task,
		'E2E_TASK_READONLY_FUTURE_REPAIR: deliver only a read-only report; future repair needs separate authorization.',
	);
	const result = await finishNativeTask(task, run.id);
	expect(result.run.status).toBe('completed');
	expect(result.text).toBe('Read-only report delivered. Future repair is not authorized and was not executed.');
	const approvals = await requestAgentWorkspace(request, task.app, {
		method: 'agent.approvals.list',
		params: { runId: run.id, after: null },
	});
	if (approvals.method !== 'agent.approvals.list') {
		throw new Error('Unexpected approvals');
	}
	expect(approvals.value.hasMore).toBe(false);
	expect(approvals.value.items).toEqual([]);
	const retired = await request.post(`/api/v1/apps/${task.app.id}/runs/${run.id}/plan`, {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: { items: [] },
	});
	expect(retired.status()).toBe(404);
});

test('a clarification completes one Run and explicit follow-up creates another in the same thread', async ({
	request,
	page,
}) => {
	const task = await prepareNativeTask(request, page);
	await openNativeTask(task);
	const first = await startNativeTask(
		task,
		'E2E_TASK_GATE_INPUT_RECOVERY: ask me to choose a report format before delivering it.',
	);
	const question = await finishNativeTask(task, first.id);
	expect(question.run.status).toBe('completed');
	expect(question.text).toBe('Choose a report format. Reply with report_format: concise.');
	await expect(page.getByText(question.text, { exact: true })).toBeVisible();
	const next = await startNativeTask(task, 'report_format: concise', [], true);
	expect(next.id).not.toBe(first.id);
	const result = await finishNativeTask(task, next.id);
	expect(result.run.status).toBe('completed');
	expect(result.run.threadId).toBe(first.threadId);
	expect(result.text).toBe('Report format: concise.');
	expect(await readNativeRun(task, first.id)).toEqual(question.run);
});

test('recorded JSON and marker cases preserve exact output through a later Run in the same thread', async ({
	request,
	page,
}) => {
	const task = await prepareNativeTask(request, page);
	await openNativeTask(task);
	const ids = new Set<string>();
	for (const fixture of regressionInputs.modelOutputs) {
		const created = await startNativeTask(task, fixture.input);
		const result = await finishNativeTask(task, created.id);
		expect(result.text).toBe(fixture.expected);
		expect(result.run.status).toBe('completed');
		expect(ids.has(created.id)).toBe(false);
		ids.add(created.id);
		// The GET used by finishNativeTask verifies durable execution, but does
		// not refresh the already-mounted Host view. Re-select the same thread
		// through its real Read action before checking rendered model output.
		await openNativeTask(task);
		await expect(page.getByText(fixture.expected, { exact: true })).toBeVisible();
	}
});

for (const fixture of regressionInputs.memoryProposals) {
	test(`recorded ${fixture.id} preserves management confidence and independently reviews a model candidate`, async ({
		request,
		page,
	}) => {
		const task = await prepareNativeTask(request, page, ['memory.propose']);
		await openNativeTask(task);
		const created = await startNativeTask(
			task,
			`E2E_REGRESSION_${fixture.id}: propose this untrusted memory: ${fixture.content}`,
		);
		const result = await finishNativeTask(task, created.id, ['memory_propose']);
		expect(result.run.status).toBe('completed');
		const candidate = JSON.parse(result.text);
		readAgentId(candidate.id);
		expect(candidate).toEqual({ id: candidate.id, status: 'candidate', version: 1 });
		const path = `/apps/${task.app.id}/memories`;
		const modelList = await requestAgentJson(
			request,
			{ method: 'GET', path: path + '?status=candidate&limit=20&offset=0' },
			readAgentMemoryListResponse,
		);
		const modelCandidate = modelList.items.find((memory) => memory.id === candidate.id);
		expect(modelCandidate).toMatchObject({
			content: fixture.content,
			confidence: 0.5,
			sourceRunId: created.id,
			version: 1,
		});
		// Confidence is management input. The model tool owns neither confidence nor source Run identity.
		const { memory: managed } = await requestAgentJson(
			request,
			{
				method: 'POST',
				path,
				status: 201,
				data: {
					content: 'Management ' + fixture.content,
					confidence: fixture.confidence,
					sourceRunId: null,
					expiresAt: null,
				},
			},
			readAgentMemoryResponse,
		);
		expect(managed.confidence).toBe(fixture.confidence);
		const reviewId = managed.id;

		const readManaged = async () =>
			(await requestAgentJson(request, { method: 'GET', path: `${path}/${reviewId}` }, readAgentMemoryResponse))
				.memory;

		const section = page.getByRole('complementary', { name: 'Memory review', exact: true });
		if (!modelCandidate) throw new Error('Model memory candidate missing');
		const row = section.locator('article').filter({ has: page.getByText(modelCandidate.content, { exact: true }) });
		await expect(section).toBeVisible();
		await expect(row).toBeVisible();
		await expect(section.getByText(managed.content, { exact: true })).toHaveCount(0);
		const endpoint = `/api/v1/agent${path}/${modelCandidate.id}/review`;
		const publishedWaiting = page.waitForResponse(
			(response) => response.url().endsWith(endpoint) && response.request().method() === 'POST',
		);
		await row.getByRole('button', { name: 'Save memory', exact: true }).click();
		const publishedResponse = await publishedWaiting;
		expect(publishedResponse.status()).toBe(200);
		expect(publishedResponse.request().postDataJSON()).toEqual({
			expectedVersion: modelCandidate.version,
			decision: 'publish',
			content: modelCandidate.content,
		});
		await expect(row).toHaveCount(0);
		const publishedModel = (
			await requestAgentJson(
				request,
				{ method: 'GET', path: `${path}/${modelCandidate.id}` },
				readAgentMemoryResponse,
			)
		).memory;
		expect(publishedModel).toMatchObject({
			id: modelCandidate.id,
			status: 'published',
			version: 2,
			confidence: 0.5,
			sourceRunId: created.id,
		});
		expect(await readManaged()).toMatchObject({
			id: reviewId,
			status: 'candidate',
			version: 1,
			confidence: fixture.confidence,
		});

		const managedEndpoint = `${path}/${reviewId}/review`;
		const published = await requestAgentJson(
			request,
			{
				method: 'POST',
				path: managedEndpoint,
				data: { expectedVersion: managed.version, decision: 'publish', content: managed.content },
			},
			readAgentMemoryResponse,
		);
		expect(published.memory).toMatchObject({
			id: reviewId,
			status: 'published',
			version: 2,
			confidence: fixture.confidence,
		});
		const stale = await requestAgentJson(
			request,
			{
				method: 'POST',
				path: managedEndpoint,
				status: 409,
				data: { expectedVersion: managed.version, decision: 'revoke', content: null },
			},
			readAgentErrorResponse,
		);
		expect(stale.code).toBe('version_conflict');
		expect(await readManaged()).toMatchObject({ id: reviewId, status: 'published', version: 2 });
		const current = await readManaged();
		const revoked = await requestAgentJson(
			request,
			{
				method: 'POST',
				path: managedEndpoint,
				data: { expectedVersion: current.version, decision: 'revoke', content: null },
			},
			readAgentMemoryResponse,
		);
		expect(revoked.memory).toMatchObject({ id: reviewId, status: 'revoked', version: 3 });
		const recallable = await requestAgentJson(
			request,
			{ method: 'GET', path: path + '?status=published&limit=20&offset=0' },
			readAgentMemoryListResponse,
		);
		expect(recallable.items.some((memory) => memory.id === reviewId)).toBe(false);
	});
}

for (const boundary of ['absolute', 'duration'] as const) {
	test(`delegation rejects invalid ${boundary} deadline without creating a child`, async ({ request, page }) => {
		// Invalid delegation arguments are rejected before creating a child;
		// the model receives the definite tool refusal and can finish its reply.
		const task = await prepareNativeTask(request, page, ['app.intents.exchange']);
		await openNativeTask(task);
		const created = await startNativeTask(task, `E2E_REGRESSION_DEADLINE_SENTINEL boundary=${boundary}`);
		const result = await finishNativeTask(task, created.id);
		expect(result.run.status).toBe('completed');
		expect(result.text).toBe('DELEGATION_REJECTED:tool_invalid_input');
		// The model response itself is complete. The rejected tool proposal
		// must not fabricate a Child or an unknown remote effect.
		const tools = await requestAgentJson(
			request,
			{ method: 'GET', path: `/apps/${task.app.id}/threads/${task.thread.id}/tools?limit=20` },
			(raw) => readAgentThreadToolsResponse(raw, task.app.id, null, 20),
		);
		expect(tools.items).toHaveLength(1);
		expect(tools.items[0]).toMatchObject({
			runId: created.id,
			toolName: 'collaboration_delegate',
			state: 'failed',
		});
		const children = await requestAgentWorkspace(request, task.app, {
			method: 'agent.subagents.list',
			params: { runId: created.id },
		});
		if (children.method !== 'agent.subagents.list') {
			throw new Error('Unexpected children');
		}
		expect(children.value.items).toEqual([]);
	});
}

test('reopening a completed clarification restores history and explicit follow-up preserves the original Run', async ({
	page,
	context,
}) => {
	const task = await prepareNativeTask(context.request, page);
	await openNativeTask(task);
	const created = await startNativeTask(task, 'E2E_REGRESSION_CLARIFICATION_UI');
	const question = await finishNativeTask(task, created.id);
	expect(question.run.status).toBe('completed');
	expect(question.text).toBe('Choose deployment color: blue or green.');
	await openNativeTask(task);
	await expect(page.getByText(question.text, { exact: true })).toBeVisible();
	await openNativeTaskPanel(page);
	const followUp = await startNativeTask(task, 'deployment_color: green', [], true);
	const answer = await finishNativeTask(task, followUp.id);
	expect(answer.run.status).toBe('completed');
	expect(answer.text).toBe('CHOSEN:green');
	expect(followUp.id).not.toBe(created.id);
	expect(await readNativeRun(task, created.id)).toEqual(question.run);
	await expect(page.getByText('CHOSEN:green', { exact: true })).toBeVisible();
});

test('image tool shows a persisted preview and download without model-authored Markdown', async ({ request, page }) => {
	const task = await prepareNativeTask(request, page, ['context.read', 'artifacts.read', 'artifacts.write']);
	await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/ai/providers',
			status: 201,
			data: {
				kind: 'openai-compatible',
				displayName: 'E2E image provider',
				baseUrl: E2E_URLS.openAiProviderOrigin + '/v1',
				protocol: 'images',
				models: [{ id: 'e2e-image', supportsTools: false, supportsImageGeneration: true }],
				enabled: true,
				credential: 'e2e-provider-secret',
			},
		},
		readAgentProviderView,
	);
	const hub = await openNativeTask(task);
	const run = await startNativeTask(task, 'E2E_AUTOMATIC_IMAGE_PREVIEW');
	const approval = await waitNativeApproval(task, run.id, 'image_generate');
	await expect(hub.locator('.agent-generated-image')).toHaveCount(0);
	await resolveNativeApproval(task, approval, 'approved');
	const completed = await finishNativeTask(task, run.id);
	expect(completed.run.status).toBe('completed');
	expect(completed.text).toBe('Image generated and saved.');
	const tools = await requestAgentJson(
		request,
		{ method: 'GET', path: `/apps/${task.app.id}/threads/${task.thread.id}/tools?limit=100` },
		(value) => readAgentThreadToolsResponse(value, task.app.id, task.thread.id, 100),
	);
	const imageTool = tools.items.find((tool) => tool.toolName === 'image_generate');
	expect(imageTool?.state).toBe('completed');
	expect(imageTool?.generatedImageId).toMatch(/^[a-f0-9-]{36}$/);
	const root = `/api/v1/agent/apps/${task.app.id}/artifacts/${imageTool?.generatedImageId}`;
	const preview = hub.locator('.agent-generated-image img');
	await expect(preview).toHaveAttribute('src', root + '/preview');
	await expect
		.poll(() => preview.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
		.toBe(true);
	await expect(hub.locator('.agent-generated-image__download')).toHaveAttribute('href', root + '/content');
	const download = await request.get(root + '/content');
	expect(download.status()).toBe(200);
	expect(download.headers()['content-type']).toContain('application/octet-stream');
	expect((await download.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
	await page.reload();
	await openNativeTask(task);
	await expect(preview).toHaveAttribute('src', root + '/preview');
	await expect
		.poll(() => preview.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
		.toBe(true);
});
