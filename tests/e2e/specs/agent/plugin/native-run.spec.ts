import { hasToolIdentity, hasApprovalIdentity } from '../../../../support/package-tool-catalog.mjs';
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import {
	prepareNativeTask,
	openNativeTask,
	startNativeTask,
	finishNativeTask,
	cancelNativeTask,
	readNativeRun,
	waitNativeApproval,
} from '../../../fixtures/agent/native-task';
import { configureTestPluginRepository, installTestPlugin } from '../../../support/plugins';
import { requestAgentJson } from '../../../support/agent-request';
import { requestAgentWorkspace } from '../../../support/agent';
import { readAgentThreadToolsResponse } from '../../../../../packages/shared/src/agent/tools/http-codec';
import { readAgentErrorResponse } from '../../../../../packages/shared/src/agent/http-codec';
import { expect, test } from '../../../support/fixtures';
import { loginAsInitialAdmin } from '../../../support/auth';
import { step } from '../../../support/steps';
import { ensureTestSshConnection } from '../../../support/ssh';
import { enablePluginApp, repositoryUrl } from './fixtures';

test.use({ actionTimeout: 10_000 });

test('remote signed Nexus Agent plugin installs, registers an Agent definition, and completes a real Run', async ({
	request,
	page,
}) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const catalog = await configureTestPluginRepository(request);
	expect(catalog.packages).toContainEqual(expect.objectContaining({ packageId: 'nexus.agent', compatible: true }));
	expect(catalog.packages).toContainEqual(
		expect.objectContaining({ packageId: 'nexus.agent', version: '1.0.4', compatible: false }),
	);
	await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/plugins/remote/stage',
			status: 403,
			data: {
				repositoryUrl,
				packageId: 'nexus.agent',
				publisherKeyId: catalog.packages.find((entry) => entry.packageId === 'nexus.agent')?.publisherKeyId,
				version: '1.0.4',
			},
		},
		(raw) => expect(readAgentErrorResponse(raw)).toEqual({ code: 'forbidden' }),
	);
	const executable = catalog.packages.find((entry) => entry.packageId === 'nexus.agent' && entry.compatible);
	expect(executable).toBeDefined();
	const installed = await installTestPlugin(request, 'nexus.agent');
	expect(installed.version).toBe(executable?.version);
	const app = await enablePluginApp(request, installed.appId);
	const task = await prepareNativeTask(
		request,
		page,
		['context.read', 'app.intents.exchange', 'file.read', 'machine.inspect', 'shell.execute'],
		[connectionId],
		app,
	);
	const definitions = await requestAgentWorkspace(request, app, { method: 'agent.definitions.list', params: {} });
	if (definitions.method !== 'agent.definitions.list') {
		throw new Error('Unexpected definition list');
	}
	expect(definitions.value).toContainEqual(
		expect.objectContaining({ id: installed.definitionId, version: installed.version }),
	);
	await openNativeTask(task);

	const execute = async (prompt: string, approved: string[] = []) => {
		const run = await startNativeTask(task, prompt, [connectionId]);
		try {
			const result = await finishNativeTask(task, run.id, approved);
			expect(result.run.status).toBe('completed');
			return result;
		} finally {
			await cancelNativeTask(task, run.id);
		}
	};

	await step('signed Skills expose metadata first and exact hash-bound document reads', async () => {
		for (const name of ['developer', 'operations']) {
			const result = await execute('E2E_NATIVE_PLUGIN_SKILL ' + name);
			const report = JSON.parse(result.text);
			expect(report.marker).toBe('SKILL_OK');
			const source = await readFile(
				path.resolve(__dirname, '../../../fixtures/agent/plugin-source/nexus.agent/skills', name, 'SKILL.md'),
				'utf8',
			);
			const body = source.slice(source.indexOf('\n---\n') + '\n---\n'.length);
			expect(report.document).toMatchObject({
				name,
				sha256: createHash('sha256').update(source).digest('hex'),
				body,
			});
			expect(report.metadata.matches).toContainEqual(
				expect.objectContaining({ name, sha256: report.document.sha256 }),
			);
			for (const match of report.metadata.matches) expect(match).not.toHaveProperty('body');
		}
	});
	await step('one assistant turn completes both control tool calls before the next inference', async () => {
		const result = await execute('E2E_NATIVE_PLUGIN_BATCH', ['collaboration_fact_write']);
		const report = JSON.parse(result.text);
		expect(report).toMatchObject({
			marker: 'BATCH_OK',
			first: { fact: { key: 'native_batch_first', value: '0', version: 1 } },
			second: { fact: { key: 'native_batch_second', value: '1', version: 1 } },
		});
		const tools = await requestAgentJson(
			request,
			{ method: 'GET', path: `/apps/${app.id}/threads/${task.thread.id}/tools?limit=100` },
			(raw) => readAgentThreadToolsResponse(raw, app.id, null, 100),
		);
		const records = tools.items.filter((tool) => tool.runId === result.run.id);
		const discoveries = records.filter((tool) => hasToolIdentity(tool, 'tool_search'));
		expect(discoveries).toHaveLength(1);
		expect(discoveries[0]).toMatchObject({ state: 'completed', mutation: false });
		const writes = records.filter((tool) => hasToolIdentity(tool, 'collaboration_fact_write'));
		expect(writes).toHaveLength(2);
		for (const write of writes) {
			expect(write.state).toBe('completed');
			expect(write.sequence).toBeGreaterThan(discoveries[0].sequence);
		}
		const approvals = await requestAgentWorkspace(request, app, {
			method: 'agent.approvals.list',
			params: { runId: result.run.id, after: null },
		});
		if (approvals.method !== 'agent.approvals.list') {
			throw new Error('Unexpected approvals');
		}
		expect(approvals.value.hasMore).toBe(false);
		expect(approvals.value.items).toHaveLength(2);
		for (const approval of approvals.value.items) {
			expect(hasApprovalIdentity(approval, 'collaboration_fact_write')).toBe(true);
			expect(approval.operationName).toBe('collaboration.writeFact');
			expect(approval.risk).toBe('control');
		}
	});
	await step('parallel-safe reads preserve a complete assistant/tool batch', async () => {
		const result = await execute(`E2E_NATIVE_PLUGIN_BATCH read=true connection=${connectionId}`);
		const report = JSON.parse(result.text);
		expect(report.marker).toBe('BATCH_OK');
		expect(JSON.stringify(report.first)).toContain(String(connectionId));
		expect(report.second.items[0].value.text).toContain('nexus-e2e-seed');
	});
	await step(
		'the installed remote file reader uses the selected SSH capability and returns an actual content hash',
		async () => {
			const report = JSON.parse((await execute(`E2E_NATIVE_PLUGIN_READ connection=${connectionId}`)).text);
			const bytes = await readFile(path.resolve(__dirname, '../../../.tmp/ssh-root/seed.txt'));
			expect(report.items).toHaveLength(1);
			expect(report.items[0].value.text).toBe(bytes.toString('utf8'));
			expect(report.items[0].value.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
		},
	);
	await step('identical commands in distinct tool calls execute as two deliberate operations', async () => {
		const proof = path.resolve(__dirname, '../../../.tmp/ssh-root/duplicate-proof.txt');
		await rm(proof, { force: true });
		try {
			const result = await execute(`E2E_NATIVE_PLUGIN_DUPLICATE connection=${connectionId}`, ['shell_execute']);
			const report = JSON.parse(result.text);
			expect(report.marker).toBe('DUPLICATE_OK');
			for (const result of [report.first, report.second]) {
				expect(result.commands).toHaveLength(1);
				expect(result.commands[0]).toMatchObject({ status: 'completed', exitCode: 0 });
			}
			expect(await readFile(proof, 'utf8')).toBe('duplicate-e2e\nduplicate-e2e\n');
			expect(report.file.items[0].value.text).toBe('duplicate-e2e\nduplicate-e2e\n');
		} finally {
			await rm(proof, { force: true });
		}
	});
	await step('cancellation stops the original Run and an explicit new intent can run', async () => {
		const run = await startNativeTask(task, `E2E_NATIVE_PLUGIN_APPROVAL connection=${connectionId}`, [
			connectionId,
		]);
		await waitNativeApproval(task, run.id, 'shell_execute');
		await cancelNativeTask(task, run.id);
		expect((await readNativeRun(task, run.id)).status).toBe('cancelled');
		// Cancellation was issued by the authenticated API context, outside the
		// mounted Agent composer. Reopen the same persisted thread so its UI
		// releases the previous active-Run fence before accepting a new intent.
		await openNativeTask(task);
		expect((await execute('E2E_NATIVE_PLUGIN_OK')).text).toBe('OK');
		expect((await readNativeRun(task, run.id)).status).toBe('cancelled');
	});
});
