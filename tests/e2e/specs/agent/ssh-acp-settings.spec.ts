import { hasToolIdentity } from '../../../support/package-tool-catalog.mjs';
import { readAgentPluginFrontendRpc } from '../../../../packages/shared/src/agent/plugins/frontend-rpc-codec';
import { agentChatSurface, readAgentChatReceipt } from '../../fixtures/agent/workbench';
import { readAgentThreadToolsResponse } from '../../../../packages/shared/src/agent/tools/http-codec';
import { openNativeTaskPanel } from '../../fixtures/agent/native-task';
import {
	openAgentConversations,
	openAgentHub,
	selectAgentModel,
	createTestAgentApp,
	selectAgentExtensionsSection,
} from '../../support/agent';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { ensureTestSshConnection } from '../../support/ssh';
import { selectUiOption } from '../../support/ui-select';
import { E2E_URLS } from '../../support/test-env';
import { requestAgentJson } from '../../support/agent-request';
import { prepareAgentRun, requestAgentWorkspace } from '../../support/agent';
import {
	readAgentGrantView,
	readAgentExecutionPolicyView,
} from '../../../../packages/shared/src/agent/governance/http-codec';
import { readAgentErrorResponse } from '../../../../packages/shared/src/agent/http-codec';
import type { AgentApprovalView } from '../../../../packages/shared/src/agent/governance/model';

test.use({ actionTimeout: 10_000 });

function processGone(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid ACP process evidence');
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return true;
		throw error;
	}
}

test('retired Workspace control-plane endpoints stay unavailable without a production Runner', async ({ request }) => {
	await loginAsInitialAdmin(request);
	for (const uri of [
		'/api/v1/agent/workspace-runtime/availability',
		'/api/v1/agent/workspace-runtime/catalog',
		'/api/v1/apps/nexus.agent/workspaces',
	]) {
		const response = await request.get(uri);
		expect(response.status(), uri).toBe(404);
	}
});

import {
	pluginInstance,
	pluginInstances,
	pluginInstancePath,
	pluginSettings,
	pluginConnection,
	openProtocolSettings,
} from '../../support/plugin-settings';
import { readAgentPluginConnectionView } from '../../../../packages/shared/src/agent/plugins/connection-codec';

test('plugin settings follow signed service declarations without granting execution privileges', async ({
	page,
	context,
}) => {
	const request = context.request;
	await loginAsInitialAdmin(request);
	await setUiLanguage(request);
	const app = await createTestAgentApp(request, 'Service settings App');
	const mcp = await pluginInstance(request, app.id, 'nexus.services.mcp');
	const acp = await pluginInstance(request, app.id, 'nexus.services.acp');
	expect((await pluginSettings(request, app.id, mcp.id)).connectionKinds).toEqual(['http']);
	expect((await pluginSettings(request, app.id, acp.id)).connectionKinds).toEqual(['remoteProcess']);
	const before = await requestAgentJson(
		request,
		{ method: 'GET', path: '/apps/' + app.id + '/grants' },
		readAgentGrantView,
	);
	expect(before.grants).toEqual([]);
	const retiredRequests: string[] = [];
	page.on('request', (value) => {
		if (new URL(value.url()).pathname.includes('/integrations')) retiredRequests.push(value.url());
	});
	let dialog = await openProtocolSettings(page, app.id, mcp.name);
	const form = dialog
		.locator('form')
		.filter({ has: page.getByRole('heading', { name: 'Connection settings', exact: true }) });
	await selectUiOption(form.getByRole('combobox', { name: 'Kind', exact: true }), 'http');
	await form.getByRole('textbox', { name: 'MCP HTTP/HTTPS URL', exact: true }).fill('https://example.com/mcp');
	const saving = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/v1/agent' + pluginInstancePath(app.id, mcp.id) + '/connection' &&
			response.request().method() === 'PUT',
	);
	await form.getByRole('button', { name: 'Save', exact: true }).click();
	expect((await saving).status()).toBe(200);
	expect(await pluginConnection(request, app.id, mcp.id)).toMatchObject({
		hasCredential: false,
		connector: { kind: 'http', endpoint: 'https://example.com/mcp', privateAuthorities: [] },
	});
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	dialog = await openProtocolSettings(page, app.id, acp.name);
	const kind = dialog.getByRole('combobox', { name: 'Kind', exact: true });
	await kind.click();
	await expect(page.getByRole('option', { name: 'SSH', exact: true })).toBeVisible();
	await expect(page.getByRole('option', { name: 'HTTP', exact: true })).toHaveCount(0);
	await page.keyboard.press('Escape');
	expect(
		await requestAgentJson(request, { method: 'GET', path: '/apps/' + app.id + '/grants' }, readAgentGrantView),
	).toEqual(before);
	expect(retiredRequests).toEqual([]);
});

test('instance settings preserve credentials, isolate Apps and persist compaction in the App plugin', async ({
	page,
	context,
}) => {
	const request = context.request;
	await loginAsInitialAdmin(request);
	await setUiLanguage(request);
	const app = await createTestAgentApp(request, 'Configured App');
	const other = await createTestAgentApp(request, 'Independent App');
	const mcp = await pluginInstance(request, app.id, 'nexus.services.mcp');
	const otherMcp = await pluginInstance(request, other.id, 'nexus.services.mcp');
	const otherConnection = await pluginConnection(request, other.id, otherMcp.id);
	const connectionPath = pluginInstancePath(app.id, mcp.id) + '/connection';
	const original = await pluginConnection(request, app.id, mcp.id);
	const credential = 'retained-fixture-secret';
	const prepared = await requestAgentJson(
		request,
		{
			method: 'PUT',
			path: connectionPath,
			data: {
				expectedRevision: original.revision,
				connector: { kind: 'http', endpoint: 'https://example.com/mcp', privateAuthorities: [] },
				credential: { action: 'replace', value: credential },
			},
		},
		readAgentPluginConnectionView,
	);
	expect(prepared.hasCredential).toBe(true);
	expect(JSON.stringify(prepared)).not.toContain(credential);
	await page.setViewportSize({ width: 390, height: 844 });
	let dialog = await openProtocolSettings(page, app.id, mcp.name);
	const form = dialog
		.locator('form')
		.filter({ has: page.getByRole('heading', { name: 'Connection settings', exact: true }) });
	await form.getByRole('textbox', { name: 'MCP HTTP/HTTPS URL', exact: true }).fill('https://example.com/current');
	let saving = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/v1/agent' + connectionPath &&
			response.request().method() === 'PUT',
	);
	await form.getByRole('button', { name: 'Save', exact: true }).click();
	expect((await saving).status()).toBe(200);
	const kept = await pluginConnection(request, app.id, mcp.id);
	expect(kept).toMatchObject({
		hasCredential: true,
		revision: prepared.revision + 1,
		connector: { endpoint: 'https://example.com/current' },
	});
	const disabling = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/v1/agent' + pluginInstancePath(app.id, mcp.id) &&
			response.request().method() === 'PUT',
	);
	await dialog.getByRole('checkbox', { name: 'Enable this instance', exact: true }).click();
	expect((await disabling).status()).toBe(200);
	await expect(dialog.getByRole('checkbox', { name: 'Enable this instance', exact: true })).not.toBeChecked();
	expect(await pluginConnection(request, app.id, mcp.id)).toEqual(kept);
	expect((await pluginInstances(request, app.id)).find((value) => value.id === mcp.id)?.enabled).toBe(false);
	await selectUiOption(form.getByRole('combobox', { name: 'MCP credential', exact: true }), 'clear');
	saving = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/v1/agent' + connectionPath &&
			response.request().method() === 'PUT',
	);
	await form.getByRole('button', { name: 'Save', exact: true }).click();
	expect((await saving).status()).toBe(200);
	expect((await pluginConnection(request, app.id, mcp.id)).hasCredential).toBe(false);
	expect(await pluginConnection(request, other.id, otherMcp.id)).toEqual(otherConnection);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	// Public source availability is covered independently; keep this settings
	// scenario deterministic while displaying a genuine unavailable-source result.
	await page.route('**/api/v1/agent/plugins/official/catalog', (route) =>
		route.fulfill({ status: 503, json: { code: 'provider_unavailable' } }),
	);
	await selectAgentExtensionsSection(page, 'market');
	const row = page
		.locator('div.border-b')
		.filter({ has: page.getByText(app.name, { exact: true }) })
		.filter({ has: page.getByRole('button', { name: 'Settings', exact: true }) });
	const catalogError = page
		.getByRole('alert')
		.filter({ has: page.getByText('Request failed. Check your session or read again.', { exact: true }) });
	await catalogError.getByRole('button', { name: 'Close', exact: true }).click();
	await row.getByRole('button', { name: 'Settings', exact: true }).click();
	dialog = page.getByRole('dialog', { name: 'Plugin settings', exact: true });
	await selectUiOption(dialog.getByRole('combobox', { name: 'App using this plugin', exact: true }), app.id);
	const frame = dialog.frameLocator('iframe[title="Plugin settings"]');
	await selectUiOption(frame.getByRole('combobox', { name: 'Context compaction', exact: true }), 'aggressive');
	await frame
		.getByRole('textbox', { name: 'Additional instructions', exact: true })
		.fill('Keep this App-specific policy.');
	const root = await pluginInstance(request, app.id, app.definitionId);
	const configPath = pluginInstancePath(app.id, root.id) + '/configuration';
	await frame.getByRole('button', { name: 'Save', exact: true }).click();
	await expect
		.poll(async () => JSON.parse((await pluginSettings(request, app.id, root.id)).configuration.documentJson))
		.toEqual({ instructions: 'Keep this App-specific policy.', compactionMode: 'aggressive' });
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await page.reload();
	await selectAgentExtensionsSection(page, 'market');
	await catalogError.getByRole('button', { name: 'Close', exact: true }).click();
	await row.getByRole('button', { name: 'Settings', exact: true }).click();
	await selectUiOption(dialog.getByRole('combobox', { name: 'App using this plugin', exact: true }), app.id);
	await expect(frame.getByRole('combobox', { name: 'Context compaction', exact: true })).toHaveAttribute(
		'data-value',
		'aggressive',
	);
	await expect(frame.getByRole('textbox', { name: 'Additional instructions', exact: true })).toHaveValue(
		'Keep this App-specific policy.',
	);
	const policy = await requestAgentJson(
		request,
		{ method: 'GET', path: '/apps/' + app.id + '/execution-policy' },
		readAgentExecutionPolicyView,
	);
	expect(policy.overrides).not.toHaveProperty('contextCompactionMode');
	expect(policy.effective).not.toHaveProperty('contextCompactionMode');
});

for (const decision of ['denied', 'cancelled'] as const) {
	test(`SSH ACP settings product chain: ${decision} inner permission without a Workspace profile`, async ({
		page,
		context,
	}, testInfo) => {
		const request = context.request;
		await loginAsInitialAdmin(request);
		await setUiLanguage(request);
		const prepared = await prepareAgentRun(request);
		const { app, thread, provider } = prepared;
		const connectionId = await ensureTestSshConnection(request);
		const grantsPath = `/apps/${app.id}/grants`;
		const grants = await requestAgentJson(request, { method: 'GET', path: grantsPath }, readAgentGrantView);
		await requestAgentJson(
			request,
			{
				method: 'PUT',
				path: grantsPath,
				data: {
					expectedPolicyRevision: grants.policyRevision,
					grants: [
						{ capability: 'plugin.invoke', scope: { kind: 'global' } },
						{ capability: 'integration.acp.invoke', scope: { kind: 'global' } },
						{
							capability: 'service.transport.process',
							scope: { kind: 'targets', targets: { ssh: { mode: 'ids', ids: [String(connectionId)] } } },
						},
					],
				},
			},
			readAgentGrantView,
		);
		const directory = path.resolve(__dirname, '../../.tmp/ssh-root/acp execution');
		await mkdir(directory, { recursive: true });
		const evidencePath = path.join(directory, 'protocol.jsonl');
		const argv = [process.execPath, path.resolve(__dirname, '../../fixtures/agent/acp-process.mjs'), evidencePath];

		const instance = await pluginInstance(request, app.id, 'nexus.services.acp');
		const connectionPath = pluginInstancePath(app.id, instance.id) + '/connection';
		const editor = await openProtocolSettings(page, app.id, instance.name);
		const connectionForm = editor
			.locator('form')
			.filter({ has: page.getByRole('heading', { name: 'Connection settings', exact: true }) });
		await selectUiOption(connectionForm.getByRole('combobox', { name: 'Kind', exact: true }), 'remoteProcess');
		await selectUiOption(
			connectionForm.getByRole('combobox', { name: 'SSH connection', exact: true }),
			String(connectionId),
		);
		await connectionForm
			.getByRole('textbox', { name: 'argv (JSON string array, executable first)', exact: true })
			.fill(JSON.stringify(argv));
		await connectionForm.getByRole('textbox', { name: 'Absolute working directory', exact: true }).fill(directory);
		const saving = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/api/v1/agent' + connectionPath &&
				response.request().method() === 'PUT',
		);
		await connectionForm.getByRole('button', { name: 'Save', exact: true }).click();
		expect((await saving).status()).toBe(200);
		const configured = await pluginConnection(request, app.id, instance.id);
		expect(configured).toMatchObject({
			hasCredential: false,
			connector: { kind: 'remoteProcess', connectionId, argv, cwd: directory },
		});
		const invalid = await request.put('/api/v1/agent' + connectionPath, {
			headers: { Origin: E2E_URLS.frontendOrigin },
			data: {
				expectedRevision: configured.revision,
				connector: { kind: 'remoteProcess', connectionId, argv, cwd: 'relative/path' },
				credential: { action: 'keep' },
			},
		});
		expect(invalid.status()).toBe(400);
		expect(readAgentErrorResponse(await invalid.json())).toEqual({ code: 'invalid_input' });
		expect(await pluginConnection(request, app.id, instance.id)).toEqual(configured);
		await editor.getByRole('button', { name: 'Close', exact: true }).click();
		await page.reload();
		const reloaded = await openProtocolSettings(page, app.id, instance.name);
		await expect(reloaded.getByRole('textbox', { name: 'Absolute working directory', exact: true })).toHaveValue(
			directory,
		);
		await reloaded.getByRole('button', { name: 'Close', exact: true }).click();

		await page.goto('/connections');
		await openAgentHub(page);
		const hub = agentChatSurface(page);
		await openAgentConversations(page);
		await hub
			.locator('#agent-thread-sidebar')
			.getByRole('button')
			.filter({ has: page.getByText(thread.title, { exact: true }) })
			.click();
		await selectAgentModel(page, provider);
		await hub.getByRole('button', { name: 'Select SSH targets', exact: true }).click();
		const target = hub
			.locator('fieldset')
			.filter({ has: page.locator('legend', { hasText: 'Select SSH targets' }) });
		await target
			.getByRole('checkbox')
			.and(hub.locator(`#agent-target-${connectionId}`))
			.check();
		await page.keyboard.press('Escape');
		await hub
			.getByRole('textbox', { name: 'Task input', exact: true })
			.fill(`E2E_ACP_EXECUTE instance=${instance.id}`);
		// Hub navigation can retire the browser's CDP copy of a successful
		// Run mutation. Capture the original response through this exact route,
		// then fulfill that same request; never replay a write to read its receipt.
		// Keep the page-owned route until fixture teardown: Run creation starts
		// concurrent reads and continuous polling, so removing it can strand a read.
		const workspacePath = `/api/v1/agent/plugins/installations/${app.id}/frontend/rpc`;
		const acceptedBodies = new Map<string, unknown>();
		const routePattern = `**${workspacePath}`;
		await page.route(routePattern, async (route) => {
			const method = readAgentPluginFrontendRpc(route.request().postDataJSON()).envelope.request.method;
			if (
				route.request().method() !== 'POST' ||
				(method !== 'agent.runs.create' && method !== 'agent.runs.cancel')
			) {
				await route.continue();
				return;
			}
			const upstream = await route.fetch();
			acceptedBodies.set(method, await upstream.json());
			await route.fulfill({ response: upstream });
		});
		const runCreation = page.waitForResponse(
			(item) =>
				new URL(item.url()).pathname === workspacePath &&
				readAgentPluginFrontendRpc(item.request().postDataJSON()).envelope.request.method ===
					'agent.runs.create',
		);
		await hub.getByRole('button', { name: 'Send', exact: true }).click();
		const runResponse = await runCreation;
		expect(runResponse.status()).toBe(200);
		expect(acceptedBodies.has('agent.runs.create')).toBe(true);
		// Correlate the actual receipt through the same Shared decoder.
		const runResult = readAgentChatReceipt(
			app,
			runResponse.request().postDataJSON(),
			acceptedBodies.get('agent.runs.create'),
		).result;
		if (runResult.method !== 'agent.runs.create') throw new Error('Unexpected Run receipt');
		const runId = runResult.value.run.id;
		await expect(hub.getByRole('textbox', { name: 'Task input', exact: true })).toHaveValue('');
		await openNativeTaskPanel(page);
		await expect(hub.getByRole('button', { name: 'Cancel run', exact: true })).toBeEnabled();

		const readRun = async () => {
			const result = await requestAgentWorkspace(request, app, { method: 'agent.runs.get', params: { runId } });
			if (result.method !== 'agent.runs.get' || !result.value) throw new Error('Run is missing');
			return result.value;
		};

		const approvals = async () => {
			const result = await requestAgentWorkspace(request, app, {
				method: 'agent.approvals.list',
				params: { runId, after: null },
			});
			if (result.method !== 'agent.approvals.list') throw new Error('Unexpected approval list');
			expect(result.value.hasMore).toBe(false);
			return result.value.items;
		};

		const waitApproval = async (toolName: string): Promise<AgentApprovalView> => {
			let approval: AgentApprovalView | undefined;
			await expect
				.poll(async () => {
					const pending = (await approvals()).filter((item) => item.status === 'requested');
					approval = pending.find((item) => item.operationName === toolName);
					for (const item of pending) {
						if (approval || !['transport.session', 'transport.stdio.write'].includes(item.operationName))
							continue;
						await requestAgentWorkspace(request, app, {
							method: 'agent.approvals.resolve',
							params: {
								approvalId: item.id,
								operationId: randomUUID(),
								input: {
									decision: 'approved',
									expectedVersion: item.version,
									operationHash: item.operationHash,
								},
							},
						});
					}
					return approval !== undefined;
				})
				.toBe(true);
			if (!approval) throw new Error('Approval not found');
			return approval;
		};

		const evidence = async () =>
			(await readFile(evidencePath, 'utf8'))
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line));

		try {
			const launch = await waitApproval('transport.session');
			await requestAgentWorkspace(request, app, {
				method: 'agent.approvals.resolve',
				params: {
					approvalId: launch.id,
					operationId: randomUUID(),
					input: {
						decision: 'approved',
						expectedVersion: launch.version,
						operationHash: launch.operationHash,
					},
				},
			});
			const inner = await waitApproval('transport.permission');
			const before = await evidence();
			expect(before.filter((item) => item.event === 'request').map((item) => item.method)).toEqual([
				'initialize',
				'session/new',
				'session/prompt',
			]);
			expect(before.find((item) => item.event === 'started').cwd).toBe(directory);
			expect(before.some((item) => item.event === 'permission')).toBe(false);
			const pid = before.find((item) => item.event === 'started').pid;

			if (decision === 'cancelled') {
				const cancellation = page.waitForResponse(
					(item) =>
						new URL(item.url()).pathname === workspacePath &&
						readAgentPluginFrontendRpc(item.request().postDataJSON()).envelope.request.method ===
							'agent.runs.cancel',
				);
				await hub.getByRole('button', { name: 'Cancel run', exact: true }).click();
				const cancellationResponse = await cancellation;
				expect(cancellationResponse.status()).toBe(200);
				expect(acceptedBodies.has('agent.runs.cancel')).toBe(true);
				const cancellationResult = readAgentChatReceipt(
					app,
					cancellationResponse.request().postDataJSON(),
					acceptedBodies.get('agent.runs.cancel'),
				).result;
				expect(cancellationResult.method).toBe('agent.runs.cancel');
				await expect.poll(async () => (await readRun()).status).toBe('cancelled');
				const late = await request.post(`/api/v1/agent/apps/${app.id}/workspace`, {
					headers: { Origin: E2E_URLS.frontendOrigin },
					data: {
						appVersion: app.version,
						request: {
							method: 'agent.approvals.resolve',
							params: {
								approvalId: inner.id,
								operationId: randomUUID(),
								input: {
									decision: 'approved',
									expectedVersion: inner.version,
									operationHash: inner.operationHash,
								},
							},
						},
					},
				});
				expect(late.status()).toBe(409);
				readAgentErrorResponse(await late.json());
			} else {
				await requestAgentWorkspace(request, app, {
					method: 'agent.approvals.resolve',
					params: {
						approvalId: inner.id,
						operationId: randomUUID(),
						input: {
							decision: 'denied',
							expectedVersion: inner.version,
							operationHash: inner.operationHash,
						},
					},
				});
				await expect
					.poll(async () => {
						for (const item of await approvals()) {
							if (item.status !== 'requested' || item.operationName !== 'transport.stdio.write') continue;
							await requestAgentWorkspace(request, app, {
								method: 'agent.approvals.resolve',
								params: {
									approvalId: item.id,
									operationId: randomUUID(),
									input: {
										decision: 'approved',
										expectedVersion: item.version,
										operationHash: item.operationHash,
									},
								},
							});
						}
						return (await readRun()).status;
					})
					.toBe('completed');
				await expect
					.poll(async () => (await evidence()).some((item) => item.event === 'permission'))
					.toBe(true);
				expect((await evidence()).find((item) => item.event === 'permission').result).toEqual({
					outcome: { outcome: 'selected', optionId: 'reject' },
				});
			}
			await expect.poll(async () => (await evidence()).some((item) => item.event === 'exited')).toBe(true);
			await expect.poll(() => processGone(pid)).toBe(true);
			expect((await evidence()).filter((item) => item.event === 'started')).toHaveLength(1);
			expect(
				(await evidence()).some(
					(item) => item.event === 'permission' && item.result?.outcome?.optionId === 'allow',
				),
			).toBe(false);
			await expect(stat(evidencePath + '.forbidden')).rejects.toMatchObject({ code: 'ENOENT' });
			const tools = await requestAgentJson(
				request,
				{ method: 'GET', path: `/apps/${app.id}/threads/${runResult.value.run.threadId}/tools?limit=100` },
				(raw) => readAgentThreadToolsResponse(raw, app.id, null, 100),
			);
			const tool = tools.items.find((item) => item.runId === runId && hasToolIdentity(item, 'acp_execute'));
			expect(tool).toBeDefined();
			expect(tool!.state).toBe(decision === 'cancelled' ? 'cancelled' : 'completed');
			expect(tool).not.toHaveProperty('argumentsJson');
		} finally {
			const current = await readRun();
			if (current.status === 'pending' || current.status === 'running') {
				await requestAgentWorkspace(request, app, {
					method: 'agent.runs.cancel',
					params: { runId, operationId: randomUUID(), expectedVersion: current.version },
				});
			}
			let recorded;
			try {
				recorded = await evidence();
			} catch (error) {
				if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
			}
			if (recorded)
				await testInfo.attach('acp-protocol', {
					body: JSON.stringify(recorded, null, 2),
					contentType: 'application/json',
				});
			const started = recorded?.find((item) => item.event === 'started');
			if (started) await expect.poll(() => processGone(started.pid)).toBe(true);
			await rm(directory, { recursive: true, force: true });
		}
	});
}
