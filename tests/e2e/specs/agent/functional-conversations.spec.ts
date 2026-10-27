import { cp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import regressionInputs from '../../fixtures/agent/regression-inputs.json';
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
import { requestAgentWorkspace } from '../../support/agent';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import { digest } from './functional-regressions.helpers';

test.use({ actionTimeout: 10_000 });

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
