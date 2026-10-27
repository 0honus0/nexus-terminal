import { randomUUID } from 'node:crypto';
import { cp, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import { expect, test } from '../../support/fixtures';
import {
	prepareNativeTask,
	openNativeTask,
	startNativeTask,
	finishNativeTask,
	waitNativeApproval,
	resolveNativeApproval,
	cancelNativeTask,
} from '../../fixtures/agent/native-task';
import { requestAgentJson, requestAgentWorkspace } from '../../support/agent';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection } from '../../support/ssh';
import { installTestPlugin } from '../../support/plugins';
import { E2E_URLS } from '../../support/test-env';
import { readAgentAppResponse } from '../../../../packages/shared/src/agent/scope/http-codec';
import { readAgentErrorResponse, readAgentId } from '../../../../packages/shared/src/agent/http-codec';
import { readAgentBrowserConfiguration } from '../../../../packages/shared/src/agent/integrations/browser-http-codec';
import { digest, tcpPortOpen, processGone, listenerPid } from './functional-regressions.helpers';

test.use({ actionTimeout: 10_000 });

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
