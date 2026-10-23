import { openNativeTaskPanel } from '../../fixtures/agent/native-task';
import {
	openAgentConversations,
	openAgentHub,
	selectAgentModel,
	selectAgentExtensionsSection,
} from '../../support/agent';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { ensureTestSshConnection } from '../../support/ssh';
import { selectUiOption } from '../../support/ui-select';
import { E2E_URLS } from '../../support/test-env';
import { prepareAgentRun, requestAgentJson, requestAgentWorkspace } from '../../support/agent';
import { readAgentGrantView } from '../../../../packages/shared/src/agent/governance/http-codec';
import { readAgentAppListResponse } from '../../../../packages/shared/src/agent/scope/http-codec';
import {
	readAgentIntegrationList,
	readAgentIntegrationView,
} from '../../../../packages/shared/src/agent/integrations/http-codec';
import { readAgentErrorResponse } from '../../../../packages/shared/src/agent/http-codec';
import {
	readAgentWorkspaceRequest,
	readAgentWorkspaceResponse,
} from '../../../../packages/shared/src/agent/scope/workspace-http-codec';
import { readAgentToolResponse } from '../../../../packages/shared/src/agent/tools/http-codec';
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

for (const decision of ['denied', 'cancelled'] as const) {
	test(`SSH ACP settings product chain: ${decision} inner permission without a Workspace profile`, async ({
		page,
		context,
	}) => {
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
						{
							capability: 'integration.acp.invoke',
							scope: { kind: 'global' },
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

		await page.goto('/settings?tab=agent');
		await selectAgentExtensionsSection(page, 'integrations');
		const section = page.getByRole('region', { name: 'MCP / ACP integrations', exact: true });
		const apps = await requestAgentJson(request, { method: 'GET', path: '/apps' }, readAgentAppListResponse);
		if (apps.length > 1) {
			await selectUiOption(
				section.getByRole('combobox', { name: 'Choose an App instance', exact: true }),
				app.id,
			);
		} else {
			expect(apps.map((item) => item.id)).toEqual([app.id]);
		}
		await section.getByRole('button', { name: 'Create integration', exact: true }).click();
		const editor = page.getByRole('dialog', { name: 'Create integration', exact: true });
		await editor
			.getByRole('radiogroup', { name: 'Kind', exact: true })
			.getByRole('radio', { name: 'ACP', exact: true })
			.click();
		await editor.getByRole('textbox', { name: 'Name', exact: true }).fill('SSH ACP settings fixture');
		await selectUiOption(
			editor.getByRole('combobox', { name: 'SSH connection', exact: true }),
			String(connectionId),
		);
		await editor
			.getByRole('textbox', { name: 'argv (JSON string array, executable first)', exact: true })
			.fill(JSON.stringify(argv));
		await editor.getByRole('textbox', { name: 'Absolute working directory', exact: true }).fill(directory);
		const enabled = editor.getByRole('checkbox', { name: 'Enable integration', exact: true });
		if ((await enabled.getAttribute('aria-checked')) !== 'true') await enabled.click();
		await expect(enabled).toHaveAttribute('aria-checked', 'true');
		const integrationPath = `/api/v1/apps/${app.id}/integrations`;
		const creation = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === integrationPath && response.request().method() === 'POST',
		);
		await editor.getByRole('button', { name: 'Save', exact: true }).click();
		const response = await creation;
		expect(response.status()).toBe(201);
		// Saving the integration re-renders the app-scoped editor; the same
		// authenticated list is authoritative after the browser's response
		// body becomes unavailable. Do not submit the creation a second time.
		const savedIntegrations = await request.get(integrationPath);
		expect(savedIntegrations.ok()).toBeTruthy();
		const matches = readAgentIntegrationList(await savedIntegrations.json()).items.filter(
			(item) => item.configuration.displayName === 'SSH ACP settings fixture',
		);
		expect(matches).toHaveLength(1);
		const integration = readAgentIntegrationView(matches[0]);
		expect(integration).toMatchObject({
			appId: app.id,
			enabled: true,
			hasCredential: false,
			configuration: {
				kind: 'acp',
				displayName: 'SSH ACP settings fixture',
				connectionId,
				argv,
				cwd: directory,
				protocolVersion: '1',
			},
		});
		const invalid = await request.patch(`${integrationPath}/${integration.id}`, {
			headers: { Origin: E2E_URLS.frontendOrigin },
			data: {
				expectedVersion: integration.version,
				enabled: true,
				credential: { action: 'keep' },
				configuration: {
					kind: 'acp',
					displayName: 'SSH ACP settings fixture',
					connectionId,
					argv,
					cwd: 'relative/path',
					protocolVersion: '1',
				},
			},
		});
		expect(invalid.status()).toBe(400);
		expect(readAgentErrorResponse(await invalid.json())).toEqual({ code: 'invalid_input' });
		const listResponse = await request.get(integrationPath);
		expect(listResponse.status()).toBe(200);
		expect(readAgentIntegrationList(await listResponse.json()).items).toContainEqual(integration);
		await page.reload();
		await selectAgentExtensionsSection(page, 'integrations');
		await selectUiOption(
			section.getByRole('combobox', { name: 'Edit app permissions and policy', exact: true }),
			app.id,
		);
		const integrationCard = section.getByRole('article').filter({
			has: page.getByRole('heading', { name: 'SSH ACP settings fixture', exact: true }),
		});
		await expect(integrationCard).toBeVisible();
		await expect(integrationCard).toContainText('ACP');
		await expect(integrationCard).toContainText(directory);

		await page.goto('/connections');
		await openAgentHub(page);
		const hub = page.locator('section[aria-label="Agent"]');
		await openAgentConversations(page);
		await hub
			.locator('#agent-thread-sidebar')
			.getByRole('button')
			.filter({ has: page.getByText(thread.title, { exact: true }) })
			.click();
		await selectAgentModel(page, provider);
		await hub.getByRole('button', { name: 'Select SSH targets', exact: true }).click();
		const target = page
			.locator('fieldset')
			.filter({ has: page.locator('legend', { hasText: 'Select SSH targets' }) });
		await target
			.getByRole('checkbox')
			.and(page.locator(`#agent-target-${connectionId}`))
			.check();
		await page.keyboard.press('Escape');
		await hub
			.getByRole('textbox', { name: 'Task input', exact: true })
			.fill(`E2E_ACP_EXECUTE integration=${integration.id} version=${integration.version}`);
		// Hub navigation can retire the browser's CDP copy of a successful
		// Run mutation. Capture the original response through this exact route,
		// then fulfill that same request; never replay a write to read its receipt.
		// Keep the page-owned route until fixture teardown: Run creation starts
		// concurrent reads and continuous polling, so removing it can strand a read.
		const workspacePath = `/api/v1/agent/apps/${app.id}/workspace`;
		const acceptedBodies = new Map<string, unknown>();
		const routePattern = `**${workspacePath}`;
		await page.route(routePattern, async (route) => {
			const method = route.request().postDataJSON()?.request?.method;
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
				new URL(item.url()).pathname === `/api/v1/agent/apps/${app.id}/workspace` &&
				item.request().postDataJSON()?.request?.method === 'agent.runs.create',
		);
		await hub.getByRole('button', { name: 'Send', exact: true }).click();
		const runResponse = await runCreation;
		expect(runResponse.status()).toBe(200);
		expect(acceptedBodies.has('agent.runs.create')).toBe(true);
		// Correlate the actual receipt through the same Shared decoder.
		const runResult = readAgentWorkspaceResponse(
			acceptedBodies.get('agent.runs.create'),
			app.id,
			readAgentWorkspaceRequest(runResponse.request().postDataJSON()),
		).result;
		if (runResult.method !== 'agent.runs.create') throw new Error('Unexpected Run receipt');
		const runId = runResult.value.run.id;
		await expect(hub.getByRole('textbox', { name: 'Task input', exact: true })).toHaveValue('');
		await openNativeTaskPanel(page);
		await expect(hub.getByRole('button', { name: 'Request cancellation', exact: true })).toBeEnabled();

		const readRun = async () => {
			const result = await requestAgentWorkspace(request, app, { method: 'agent.runs.get', params: { runId } });
			if (result.method !== 'agent.runs.get' || !result.value) throw new Error('Run is missing');
			return result.value;
		};

		const approvals = async () => {
			const result = await requestAgentWorkspace(request, app, {
				method: 'agent.approvals.list',
				params: { runId },
			});
			if (result.method !== 'agent.approvals.list') throw new Error('Unexpected approval list');
			return result.value;
		};

		const waitApproval = async (toolName: string): Promise<AgentApprovalView> => {
			let approval: AgentApprovalView | undefined;
			await expect
				.poll(async () => {
					approval = (await approvals()).find(
						(item) => item.status === 'requested' && item.inspection.toolName === toolName,
					);
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
			const launch = await waitApproval('acp_integration_execute');
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
			const inner = await waitApproval('acp_inner_permission');
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
						new URL(item.url()).pathname === `/api/v1/agent/apps/${app.id}/workspace` &&
						item.request().postDataJSON()?.request?.method === 'agent.runs.cancel',
				);
				await hub.getByRole('button', { name: 'Request cancellation', exact: true }).click();
				const cancellationResponse = await cancellation;
				expect(cancellationResponse.status()).toBe(200);
				expect(acceptedBodies.has('agent.runs.cancel')).toBe(true);
				const cancellationResult = readAgentWorkspaceResponse(
					acceptedBodies.get('agent.runs.cancel'),
					app.id,
					readAgentWorkspaceRequest(cancellationResponse.request().postDataJSON()),
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
				await expect.poll(async () => (await readRun()).status).toBe('completed');
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
			const tool = await requestAgentJson(
				request,
				{ method: 'GET', path: `/apps/${app.id}/runs/${runId}/tools/${launch.toolCallId}` },
				readAgentToolResponse,
			);
			expect(tool.state).toBe(decision === 'cancelled' ? 'unknown' : 'completed');
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
			const started = recorded?.find((item) => item.event === 'started');
			if (started) await expect.poll(() => processGone(started.pid)).toBe(true);
			await rm(directory, { recursive: true, force: true });
		}
	});
}
