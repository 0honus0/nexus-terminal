import { readAgentArtifactResponse } from '../../../../packages/shared/src/agent/artifacts/http-codec';
import { readAgentBrowserConfiguration } from '../../../../packages/shared/src/agent/integrations/browser-http-codec';
import { readAgentExecutionSettingsResponse } from '../../../../packages/shared/src/agent/execution/http-codec';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import {
	resolveNativeApproval,
	captureNativeCommand,
	type NativeTask,
	prepareNativeTask,
	openNativeTask,
	openNativeTaskPanel,
	startNativeTask,
	finishNativeTask,
	cancelNativeTask,
	readNativeRun,
	waitNativeApproval,
} from '../../fixtures/agent/native-task';
import { configureTestPluginRepository, installTestPlugin, stageTestPlugin } from '../../support/plugins';
import { selectUiOption } from '../../support/ui-select';
import {
	openAgentConversations,
	selectAgentSettingsGroup,
	selectAgentExtensionsSection,
	requestAgentJson,
	requestAgentWorkspace,
	enableTestAgentExecution,
} from '../../support/agent';
import { readAgentAppListResponse, readAgentAppResponse } from '../../../../packages/shared/src/agent/scope/http-codec';
import {
	readAgentPluginItems,
	readAgentPluginStageView,
	readAgentPluginInstallation,
	readAgentPluginDataView,
	readAgentPluginDataPurgeView,
} from '../../../../packages/shared/src/agent/plugins/http-codec';
import { readAgentPluginRepositorySettings } from '../../../../packages/shared/src/agent/plugins/repository-http-codec';
import { agentRecord, readAgentErrorResponse } from '../../../../packages/shared/src/agent/http-codec';

import { expect, test, type APIRequestContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';
import { ensureTestSshConnection } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';

async function enablePluginApp(request: APIRequestContext, appId: string) {
	const before = await requestAgentJson(request, { method: 'GET', path: '/apps/' + appId }, readAgentAppResponse);
	if (before.enabled) {
		return before;
	}
	return requestAgentJson(
		request,
		{ method: 'PATCH', path: '/apps/' + appId, data: { expectedVersion: before.version, enabled: true } },
		readAgentAppResponse,
	);
}

async function cancelBrowserPhase<T>(
	creating: boolean,
	cancel: () => Promise<T>,
	stopped: () => Promise<boolean>,
): Promise<T> {
	// Keep construction blocked until the original cancellation commits its fence.
	// Observe rejection immediately while the independent status poll is pending.
	const pending = cancel().then(
		(value) => ({ status: 'ok' as const, value }),
		(error: unknown) => ({ status: 'error' as const, error }),
	);
	let pollingFailure: unknown = null;
	try {
		if (creating) {
			await expect.poll(stopped).toBe(true);
		}
	} catch (error) {
		pollingFailure = error;
	} finally {
		if (creating) {
			await releaseBrowserCreationBarrier();
		}
	}
	const result = await pending;
	if (pollingFailure !== null) {
		if (result.status === 'error') {
			throw new AggregateError([pollingFailure, result.error], 'Cancellation fence and receipt failed');
		}
		throw pollingFailure;
	}
	if (result.status === 'error') {
		throw result.error;
	}
	return result.value;
}

async function configureLifecycleBrowser(request: APIRequestContext) {
	const current = await requestAgentJson(
		request,
		{ method: 'GET', path: '/browser/configuration' },
		readAgentBrowserConfiguration,
	);
	return requestAgentJson(
		request,
		{
			method: 'PUT',
			path: '/browser/configuration',
			data: {
				expectedVersion: current.version,
				targets: [
					{
						id: 'e2e-lifecycle',
						endpoints: [
							{ url: E2E_URLS.browserCdpEndpoint, priority: 1, allowPlaintext: true, verifyTls: true },
						],
						allowedUrlPatterns: [E2E_URLS.browserControlOrigin],
					},
				],
			},
		},
		readAgentBrowserConfiguration,
	);
}

async function browserControl(path: string, method: 'GET' | 'POST' = 'GET') {
	const response = await fetch(E2E_URLS.browserControlOrigin + path, { method });
	expect(response.ok).toBe(true);
	return response.json();
}

async function releaseBrowserCreationBarrier(): Promise<void> {
	// The release fixture intentionally responds 200 with no JSON body.
	const response = await fetch(E2E_URLS.browserControlOrigin + '/creation-barrier/release', { method: 'POST' });
	expect(response.ok).toBe(true);
	expect(await response.text()).toBe('');
}

async function releaseBrowserModel() {
	const response = await fetch(E2E_URLS.openAiProviderOrigin + '/browser-lifecycle/release', { method: 'POST' });
	expect(response.ok).toBe(true);
}

async function nativeChildren(task: NativeTask, runId: string) {
	const result = await requestAgentWorkspace(task.request, task.app, {
		method: 'agent.subagents.list',
		params: { runId },
	});
	if (result.method !== 'agent.subagents.list') {
		throw new Error('Unexpected Child list');
	}
	return result.value.items;
}

async function approveNativeFamily(task: NativeTask, runId: string, allowed: string[]) {
	const ids = [runId, ...(await nativeChildren(task, runId)).map((child) => child.id)];
	for (const id of ids) {
		const result = await requestAgentWorkspace(task.request, task.app, {
			method: 'agent.approvals.list',
			params: { runId: id, after: null },
		});
		if (result.method !== 'agent.approvals.list') {
			throw new Error('Unexpected approval list');
		}
		expect(result.value.hasMore).toBe(false);
		for (const approval of result.value.items.filter((item) => item.status === 'requested')) {
			expect(allowed).toContain(approval.inspection.toolName);
			await resolveNativeApproval(task, approval, 'approved');
		}
	}
}

test.use({ actionTimeout: 10_000 });

const repositoryUrl = `${E2E_URLS.pluginRepositoryOrigin}/catalog.json`;

const openAgentHub = async (page: Page) => {
	const hub = page.getByRole('dialog', { name: 'Agent', exact: true });
	const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
	await expect.poll(async () => (await hub.isVisible()) || (await launcher.isVisible())).toBe(true);
	if (!(await hub.isVisible())) {
		await launcher.click();
	}
	await expect(hub).toBeVisible();
	return hub;
};

test('unsafe remote plugin archive fails validation without terminating the Backend', async ({ request }) => {
	await loginAsInitialAdmin(request);
	await configureTestPluginRepository(request);
	// Trust the controlled publisher first, so rejection actually reaches archive inspection.
	await stageTestPlugin(request, 'nexus.custom-surface');
	const before = await requestAgentJson(request, { method: 'GET', path: '/plugins/stages' }, (raw) =>
		readAgentPluginItems(raw, readAgentPluginStageView),
	);
	await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/plugins/remote/stage',
			status: 400,
			data: { repositoryUrl, appId: 'nexus.unsafe', version: '1.0.0' },
		},
		(raw) => expect(readAgentErrorResponse(raw)).toEqual({ code: 'invalid_input' }),
	);
	const after = await requestAgentJson(request, { method: 'GET', path: '/plugins/stages' }, (raw) =>
		readAgentPluginItems(raw, readAgentPluginStageView),
	);
	expect(after).toEqual(before);
	await requestAgentJson(request, { method: 'GET', path: '/apps' }, readAgentAppListResponse);
});

test('official plugin source cannot be overridden by a configured third-party repository', async ({
	request,
	page,
}) => {
	await loginAsInitialAdmin(request);
	await loginAsInitialAdmin(page.request);
	await setUiLanguage(page.request);
	const empty = await requestAgentJson(
		request,
		{ method: 'GET', path: '/plugins/repositories' },
		readAgentPluginRepositorySettings,
	);
	expect(empty.repositories).toEqual([]);
	const catalog = await configureTestPluginRepository(request);
	expect(catalog.repositoryUrl).toBe(repositoryUrl);
	await requestAgentJson(
		request,
		{
			method: 'GET',
			path: '/plugins/official/catalog?repositoryUrl=' + encodeURIComponent(repositoryUrl),
			status: 400,
		},
		(raw) => expect(readAgentErrorResponse(raw)).toEqual({ code: 'invalid_input' }),
	);
	await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/plugins/official/stage',
			status: 400,
			data: { appId: 'nexus.fullstack', version: '1.0.0', repositoryUrl },
		},
		(raw) => expect(readAgentErrorResponse(raw)).toEqual({ code: 'invalid_input' }),
	);
	const installations = await requestAgentJson(request, { method: 'GET', path: '/plugins/installations' }, (raw) =>
		readAgentPluginItems(raw, readAgentPluginInstallation),
	);
	expect(installations.items).toEqual([]);
	const officialRead = page.waitForRequest(
		(candidate) =>
			candidate.method() === 'GET' &&
			new URL(candidate.url()).pathname === '/api/v1/agent/plugins/official/catalog',
	);
	await page.goto('/settings?tab=agent');
	await selectAgentExtensionsSection(page, 'market');
	expect(new URL((await officialRead).url()).search).toBe('');
	const section = page.getByRole('region', { name: 'Plugin management', exact: true });
	await expect(
		section.getByRole('button', { name: 'Copy', exact: true }).filter({ hasText: repositoryUrl }),
	).toBeVisible();
	await expect(section.getByRole('button', { name: 'Read official catalog', exact: true })).toHaveCount(0);
	// D16: actual first-party catalog, pinned publisher and signed download require external acceptance.
});

test('uninstalled plugin retained AppStorage can be permanently deleted', async ({ request }) => {
	await loginAsInitialAdmin(request);
	await enableTestAgentExecution(request);
	const installation = await installTestPlugin(request, 'nexus.custom-surface');
	const app = await enablePluginApp(request, installation.appId);
	const path = `/plugins/installations/${app.id}`;
	const stored = await requestAgentJson(
		request,
		{
			method: 'PUT',
			path: path + '/data/e2e.retained',
			data: {
				expectedRevision: installation.revision,
				expectedVersion: 0,
				operationId: randomUUID(),
				valueJson: JSON.stringify({ retained: true }),
			},
		},
		readAgentPluginDataView,
	);
	expect(JSON.parse(stored.valueJson!)).toEqual({ retained: true });
	const fetched = await requestAgentJson(request, { method: 'GET', path: path + '/data/e2e.retained' }, (raw) => {
		const row = agentRecord(raw, ['value']);
		return row.value === null ? null : readAgentPluginDataView(row.value);
	});
	expect(fetched).toEqual(stored);
	const removed = await requestAgentJson(
		request,
		{
			method: 'DELETE',
			path,
			data: { expectedRevision: installation.revision },
		},
		readAgentPluginInstallation,
	);
	expect(removed.status).toBe('removed');
	const purge = { expectedRevision: removed.revision, operationId: randomUUID() };
	const deleted = await requestAgentJson(
		request,
		{ method: 'POST', path: path + '/delete-data', data: purge },
		readAgentPluginDataPurgeView,
	);
	expect(deleted.deletedKeys).toBe(1);
	expect(deleted.revision).toBe(removed.revision + 1);
	const replay = await requestAgentJson(
		request,
		{ method: 'POST', path: path + '/delete-data', data: purge },
		readAgentPluginDataPurgeView,
	);
	expect(replay).toEqual(deleted);
	await requestAgentJson(
		request,
		{
			method: 'POST',
			path: path + '/delete-data',
			status: 409,
			data: { expectedRevision: removed.revision, operationId: randomUUID() },
		},
		(raw) => expect(readAgentErrorResponse(raw)).toEqual({ code: 'version_conflict' }),
	);
	const empty = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: path + '/delete-data',
			data: { expectedRevision: deleted.revision, operationId: randomUUID() },
		},
		readAgentPluginDataPurgeView,
	);
	expect(empty.deletedKeys).toBe(0);
});

test('frontend target owns a full Custom App Surface and connects through the isolated Plugin SDK', async ({
	page,
	context,
}) => {
	const request = context.request;
	await loginAsInitialAdmin(request);
	await setUiLanguage(request);
	await enableTestAgentExecution(request);
	const custom = await installTestPlugin(request, 'nexus.custom-surface');
	const agent = await installTestPlugin(request, 'nexus.agent');
	const fullstack = await installTestPlugin(request, 'nexus.fullstack');
	for (const installed of [custom, agent, fullstack]) {
		await enablePluginApp(request, installed.appId);
	}
	const installations = await requestAgentJson(request, { method: 'GET', path: '/plugins/installations' }, (raw) =>
		readAgentPluginItems(raw, readAgentPluginInstallation),
	);
	for (const installed of [custom, agent, fullstack]) {
		expect(installations.items).toContainEqual(installed);
	}
	await page.goto('/settings?tab=agent');
	await selectAgentSettingsGroup(page, 'tools');
	const section = page.getByRole('region', { name: 'Plugin management', exact: true });

	const appsSection = page.getByRole('region', { name: 'Agent apps', exact: true });
	await selectAgentExtensionsSection(page, 'market');
	await expect(section.getByRole('button', { name: 'Refresh repositories', exact: true })).toBeVisible();
	await expect(section.locator('input[type="file"]')).toHaveCount(0);
	await expect(section.getByRole('button', { name: 'Choose signed package', exact: true })).toHaveCount(0);
	for (const installed of [custom, agent, fullstack]) {
		await selectAgentExtensionsSection(page, 'apps');
		const card = appsSection.locator('article[data-app-id="' + installed.appId + '"]');
		await expect(card).toBeVisible();
		await expect(card.getByText('v' + installed.version, { exact: true })).toBeVisible();
		await expect(card.getByRole('button', { name: 'Uninstall', exact: true })).toBeDisabled();
		await expect(card.getByRole('button', { name: 'Configure Policies', exact: true })).toBeVisible();
	}

	await captureFunctionalScreenshot(page, 'agent-plugins-multiple-installed.png', {
		viewport: { width: 1440, height: 900 },
	});
	await selectAgentExtensionsSection(page, 'market');
	await expect(section.getByText('Runtime observations', { exact: true })).toHaveCount(0);
	await page.goto('/settings?tab=data');
	const maintenance = page.locator('details').filter({
		has: page.locator('summary').filter({ hasText: /^Diagnostics and recovery \(advanced\)$/ }),
	});
	await maintenance.getByText('Diagnostics and recovery (advanced)', { exact: true }).click();
	await expect(maintenance.getByText('Host diagnostics', { exact: true })).toBeVisible();
	await expect(maintenance.getByText('Machine mutation recovery', { exact: true })).toBeVisible();
	await expect(maintenance.getByText('Installation recovery and upgrade packages', { exact: true })).toHaveCount(0);
	await expect(maintenance.getByText('Runtime observations', { exact: true })).toHaveCount(0);
	await page.goto('/connections');
	const hub = await openAgentHub(page);

	const choose = async (appId: string) => {
		const app = await requestAgentJson(request, { method: 'GET', path: '/apps/' + appId }, readAgentAppResponse);
		await hub.getByRole('button', { name: 'Choose an Agent app', exact: true }).click();
		await page
			.locator('[data-agent-hub-portal]')
			.getByRole('button')
			.filter({ has: page.getByText(app.name, { exact: true }) })
			.click();
	};

	await choose(custom.appId);
	const customFrame = hub.locator('iframe').filter({ visible: true }).contentFrame();
	await expect(customFrame.getByRole('heading', { name: 'Custom Surface Fixture' })).toBeVisible();
	await expect(customFrame.getByTestId('custom-sdk-status')).toHaveText(
		`ready:${custom.appId}:nexus.custom-surface`,
		{ timeout: 15_000 },
	);
	await expect(hub.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
	await choose(fullstack.appId);
	const frame = hub.locator('iframe').filter({ visible: true });
	await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
	const surface = frame.contentFrame();
	await expect(surface.getByTestId('fullstack-frontend-status')).toHaveText(
		`frontend:ready:${fullstack.appId}@1.0.0`,
	);
	await expect(surface.getByTestId('fullstack-backend-status')).toHaveText('backend:active');
	await surface.getByTestId('fullstack-write-storage').click();
	await expect(surface.getByTestId('fullstack-storage-result')).toHaveText('storage:version:1:counter:1');
	const stored = await requestAgentJson(
		request,
		{ method: 'GET', path: `/plugins/installations/${fullstack.appId}/data/frontend.demo` },
		(raw) => {
			const row = agentRecord(raw, ['value']);
			return readAgentPluginDataView(row.value);
		},
	);
	expect(JSON.parse(stored.valueJson!)).toEqual({ source: 'frontend', counter: 1 });
	const backend = await requestAgentJson(
		request,
		{ method: 'GET', path: `/plugins/installations/${fullstack.appId}/data/backend.status` },
		(raw) => {
			const row = agentRecord(raw, ['value']);
			return readAgentPluginDataView(row.value);
		},
	);
	expect(JSON.parse(backend.valueJson!)).toMatchObject({
		appId: fullstack.appId,
		state: 'active',
		fileReadDenied: true,
		childProcessDenied: true,
	});
	const crossed = await requestAgentJson(
		request,
		{ method: 'GET', path: `/plugins/installations/${custom.appId}/data/frontend.demo` },
		(raw) => agentRecord(raw, ['value']),
	);
	expect(crossed.value).toBeNull();
	await choose(custom.appId);
	await expect(
		hub.locator('iframe').filter({ visible: true }).contentFrame().getByTestId('custom-sdk-status'),
	).toHaveText(`ready:${custom.appId}:nexus.custom-surface`);
});

test('Nexus Agent Browser lifecycle cases reclaim contexts across cancellation and approval boundaries', async ({
	request,
	page,
}) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const installed = await installTestPlugin(request, 'nexus.agent');
	const app = await enablePluginApp(request, installed.appId);
	const task = await prepareNativeTask(
		request,
		page,
		['browser.read', 'browser.interact', 'shell.execute'],
		[connectionId],
		app,
	);
	const browser = await configureLifecycleBrowser(request);
	await openNativeTask(task);
	for (const phase of ['cancel-creating', 'complete', 'cancel-live', 'repeat', 'cancel-approval', 'approve']) {
		await step(`Root Browser cleanup: ${phase}`, async () => {
			// The prior Run is terminated by the separately authenticated API
			// owner. Re-read the same persisted thread before composing a new Run;
			// an already-mounted composer can still display the old active fence.
			await openNativeTask(task);
			const creating = phase === 'cancel-creating';
			const approval = phase === 'cancel-approval' || phase === 'approve';
			const cancel = phase.startsWith('cancel-');
			const baseline = (await browserControl('/contexts')).browserContextIds;
			if (creating) {
				await browserControl('/creation-barrier', 'POST');
			}
			const run = await startNativeTask(
				task,
				`E2E_BROWSER_LIFECYCLE ${randomUUID()} version=${browser.version}${approval ? ' E2E_BROWSER_APPROVAL=' + connectionId : ''}`,
				[connectionId],
			);
			try {
				try {
					const open = await waitNativeApproval(task, run.id, 'browser_open');
					await resolveNativeApproval(task, open, 'approved');
					if (creating) {
						await expect.poll(async () => (await browserControl('/creation-barrier')).held).toBe(true);
					} else if (approval) {
						await waitNativeApproval(task, run.id, 'shell_execute');
					} else {
						await expect
							.poll(
								async () =>
									(await (await fetch(E2E_URLS.openAiProviderOrigin + '/browser-lifecycle')).json())
										.held,
							)
							.toBe(true);
					}
					await expect
						.poll(async () => (await browserControl('/contexts')).browserContextIds)
						.toHaveLength(baseline.length + 1);
					expect((await readNativeRun(task, run.id)).status).toBe('running');
					if (cancel) {
						await cancelBrowserPhase(
							creating,
							() => cancelNativeTask(task, run.id),
							async () => (await readNativeRun(task, run.id)).status === 'cancelled',
						);
					} else if (approval) {
						await resolveNativeApproval(
							task,
							await waitNativeApproval(task, run.id, 'shell_execute'),
							'approved',
						);
						await expect
							.poll(
								async () =>
									(await (await fetch(E2E_URLS.openAiProviderOrigin + '/browser-lifecycle')).json())
										.held,
							)
							.toBe(true);
					}
				} finally {
					if (creating) {
						await releaseBrowserCreationBarrier();
					}
					await releaseBrowserModel();
				}
				const result = await finishNativeTask(task, run.id);
				expect(result.run.status).toBe(cancel ? 'cancelled' : 'completed');
				if (!cancel) {
					expect(result.text).toBe('Browser lifecycle fixture completed.');
				}
				await expect.poll(async () => (await browserControl('/contexts')).browserContextIds).toEqual(baseline);
				if (phase === 'cancel-approval') {
					const approvals = await requestAgentWorkspace(request, app, {
						method: 'agent.approvals.list',
						params: { runId: run.id, after: null },
					});
					if (approvals.method !== 'agent.approvals.list') {
						throw new Error('Unexpected approvals');
					}
					expect(approvals.value.hasMore).toBe(false);
					expect(
						approvals.value.items.filter((item) => item.inspection.toolName === 'shell_execute'),
					).toHaveLength(1);
					expect(
						approvals.value.items.find((item) => item.inspection.toolName === 'shell_execute')!.consumedAt,
					).toBeNull();
				}
			} finally {
				await cancelNativeTask(task, run.id);
			}
		});
	}
});

test('Nexus Agent subagent lifecycle preserves tool batches and reclaims child Browser contexts', async ({
	request,
	page,
}) => {
	await loginAsInitialAdmin(request);
	const installed = await installTestPlugin(request, 'nexus.agent');
	const app = await enablePluginApp(request, installed.appId);
	const task = await prepareNativeTask(
		request,
		page,
		['app.intents.exchange', 'browser.read', 'browser.interact'],
		[],
		app,
	);
	const browser = await configureLifecycleBrowser(request);
	const configured = await requestAgentJson(
		request,
		{ method: 'GET', path: '/execution-settings' },
		readAgentExecutionSettingsResponse,
	);
	await requestAgentJson(
		request,
		{
			method: 'PUT',
			path: '/execution-settings',
			data: {
				expectedVersion: configured.settings.version,
				enabled: true,
				limits: configured.settings.limits,
			},
		},
		readAgentExecutionSettingsResponse,
	);
	await openNativeTask(task);
	await step('Child history preserves one assistant turn and both read tool results', async () => {
		const run = await startNativeTask(task, 'E2E_NATIVE_PLUGIN_DELEGATE');
		try {
			const result = await finishNativeTask(task, run.id, ['collaboration_delegate']);
			expect(result.run.status).toBe('completed');
			const report = JSON.parse(result.text);
			expect(report.joined).toMatchObject({
				ready: true,
				children: [{ status: 'completed', output: 'CHILD_BATCH_OK' }],
			});
			const children = await nativeChildren(task, run.id);
			expect(children).toHaveLength(1);
			expect(children[0]).toMatchObject({ parentId: run.id, status: 'completed', profile: 'worker' });
			expect(children[0].id).not.toBe(run.id);
		} finally {
			await cancelNativeTask(task, run.id);
		}
	});
	for (const phase of ['complete', 'cancel-live', 'cancel-creating', 'child-cancel-live', 'child-cancel-creating']) {
		await step(`Child Browser resources settle: ${phase}`, async () => {
			// Refresh the authoritative same-thread view after the previous child
			// Run finished through the API. The mounted composer may otherwise
			// remain disabled against the retired active-run fence.
			await openNativeTask(task);
			const independent = phase.startsWith('child-');
			const creating = phase.endsWith('creating');
			const cancelled = phase !== 'complete';
			const baseline = (await browserControl('/contexts')).browserContextIds;
			if (creating) {
				await browserControl('/creation-barrier', 'POST');
			}
			const run = await startNativeTask(
				task,
				`E2E_NATIVE_PLUGIN_DELEGATE browser=true version=${browser.version}`,
			);
			try {
				try {
					await expect
						.poll(
							async () => {
								await approveNativeFamily(task, run.id, ['collaboration_delegate', 'browser_open']);
								return creating
									? (await browserControl('/creation-barrier')).held
									: (await (await fetch(E2E_URLS.openAiProviderOrigin + '/browser-lifecycle')).json())
											.held;
							},
							{ timeout: 20_000 },
						)
						.toBe(true);
					await expect
						.poll(async () => (await browserControl('/contexts')).browserContextIds)
						.toHaveLength(baseline.length + 1);
					const children = await nativeChildren(task, run.id);
					expect(children).toHaveLength(1);
					if (cancelled) {
						if (independent) {
							const child = children[0];
							await requestAgentJson(
								request,
								{
									method: 'POST',
									path: `/apps/${app.id}/workspace`,
									status: 409,
									data: {
										appVersion: app.version,
										request: {
											method: 'agent.subagents.cancel',
											params: {
												runId: run.id,
												childId: child.id,
												operationId: randomUUID(),
												expectedVersion: child.version + 100,
											},
										},
									},
								},
								(raw) => expect(readAgentErrorResponse(raw)).toEqual({ code: 'version_conflict' }),
							);
							const receipt = await cancelBrowserPhase(
								creating,
								() =>
									requestAgentWorkspace(request, app, {
										method: 'agent.subagents.cancel',
										params: {
											runId: run.id,
											childId: child.id,
											operationId: randomUUID(),
											expectedVersion: child.version,
										},
									}),
								async () =>
									(await nativeChildren(task, run.id)).find((item) => item.id === child.id)
										?.status === 'cancelled',
							);
							if (receipt.method !== 'agent.subagents.cancel') {
								throw new Error('Unexpected Child cancellation');
							}
							expect(receipt.value.run.status).toBe('cancelled');
						} else {
							await cancelBrowserPhase(
								creating,
								() => cancelNativeTask(task, run.id),
								async () => (await readNativeRun(task, run.id)).status === 'cancelled',
							);
						}
					}
				} finally {
					if (creating) {
						await releaseBrowserCreationBarrier();
					}
					await releaseBrowserModel();
				}
				const result = await finishNativeTask(task, run.id);
				expect(result.run.status).toBe(
					cancelled ? (independent ? (creating ? 'unknown' : 'completed') : 'cancelled') : 'completed',
				);
				expect((await nativeChildren(task, run.id))[0].status).toBe(cancelled ? 'cancelled' : 'completed');
				if (!cancelled) {
					expect(result.text).toContain('Browser lifecycle fixture completed.');
				}
				await expect.poll(async () => (await browserControl('/contexts')).browserContextIds).toEqual(baseline);
			} finally {
				await cancelNativeTask(task, run.id);
			}
		});
	}
});

test('remote signed Nexus Agent plugin installs, registers an Agent definition, and completes a real Run', async ({
	request,
	page,
}) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const catalog = await configureTestPluginRepository(request);
	expect(catalog.packages).toContainEqual(
		expect.objectContaining({ appId: 'nexus.agent', version: '1.0.0', sdkVersion: '1', compatible: true }),
	);
	expect(catalog.packages).toContainEqual(
		expect.objectContaining({ appId: 'nexus.agent', version: '1.0.4', compatible: false }),
	);
	await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/plugins/remote/stage',
			status: 403,
			data: { repositoryUrl, appId: 'nexus.agent', version: '1.0.4' },
		},
		(raw) => expect(readAgentErrorResponse(raw)).toEqual({ code: 'forbidden' }),
	);
	const installed = await installTestPlugin(request, 'nexus.agent');
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
			expect(JSON.stringify(report.metadata)).not.toContain(
				name === 'developer'
					? 'Use an explicitly selected and authorized SSH connection'
					: 'Prefer structured diagnostics',
			);
			expect(JSON.stringify(report.document)).toContain(
				name === 'developer'
					? 'Use an explicitly selected and authorized SSH connection'
					: 'Prefer structured diagnostics',
			);
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
			expect(approval.inspection).toMatchObject({ toolName: 'collaboration_fact_write', risk: 'control' });
		}
	});
	await step('parallel-safe reads preserve a complete assistant/tool batch', async () => {
		const result = await execute(`E2E_NATIVE_PLUGIN_BATCH read=true connection=${connectionId}`);
		const report = JSON.parse(result.text);
		expect(report.marker).toBe('BATCH_OK');
		expect(JSON.stringify(report.first)).toContain(String(connectionId));
		expect(report.second.text).toContain('nexus-e2e-seed');
	});
	await step('file_read uses the selected SSH capability and returns an actual content hash', async () => {
		const report = JSON.parse((await execute(`E2E_NATIVE_PLUGIN_READ connection=${connectionId}`)).text);
		const bytes = await readFile(path.resolve(__dirname, '../../.tmp/ssh-root/seed.txt'));
		expect(report.text).toBe(bytes.toString('utf8'));
		expect(report.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
	});
	await step('identical commands in distinct tool calls execute as two deliberate operations', async () => {
		const proof = path.resolve(__dirname, '../../.tmp/ssh-root/duplicate-proof.txt');
		await rm(proof, { force: true });
		try {
			const result = await execute(`E2E_NATIVE_PLUGIN_DUPLICATE connection=${connectionId}`, ['shell_execute']);
			const report = JSON.parse(result.text);
			expect(report).toMatchObject({ marker: 'DUPLICATE_OK', first: { exitCode: 0 }, second: { exitCode: 0 } });
			expect(await readFile(proof, 'utf8')).toBe('duplicate-e2e\nduplicate-e2e\n');
			expect(report.file.text).toBe('duplicate-e2e\nduplicate-e2e\n');
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

test('installed Nexus Agent plugin uses the host-owned Agent surface and captures functional evidence', async ({
	page,
	context,
}) => {
	const request = context.request;
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const installed = await installTestPlugin(request, 'nexus.agent');
	const app = await enablePluginApp(request, installed.appId);
	const task = await prepareNativeTask(
		request,
		page,
		['shell.execute', 'file.read', 'machine.inspect', 'artifacts.read'],
		[connectionId],
		app,
	);
	let hub = await openNativeTask(task);
	await step('the installed definition uses native host UI and durable Run history', async () => {
		const run = await startNativeTask(task, 'E2E_NATIVE_PLUGIN_OK');
		expect((await finishNativeTask(task, run.id)).run.status).toBe('completed');
		await expect(hub.getByText('OK', { exact: true })).toBeVisible();
		await expect(hub.getByRole('button', { name: 'Environment', exact: true })).toHaveCount(0);
		await expect(hub.getByRole('button', { name: 'Execution mode', exact: true })).toHaveCount(0);
		await openNativeTaskPanel(page);
		await hub
			.getByRole('complementary', { name: 'Tasks', exact: true })
			.locator('details > summary')
			.filter({ hasText: /^Technical details$/ })
			.first()
			.click();
		await hub.getByText('Step and tool audit', { exact: true }).click();
		const audit = hub
			.locator('details')
			.filter({ has: page.locator(':scope > summary').filter({ hasText: /^Step and tool audit$/ }) });
		await audit.getByLabel('Step index', { exact: true }).fill('1');
		await audit.getByRole('button', { name: 'Refresh current state', exact: true }).first().click();
		await expect(audit).toContainText('step.completed');
		await expect(audit).toContainText('Input / output tokens');
		await captureFunctionalScreenshot(page, 'agent-installed-native-run.png', {
			viewport: { width: 1440, height: 900 },
		});
		await hub
			.getByRole('complementary', { name: 'Tasks', exact: true })
			.getByRole('button', { name: 'Close', exact: true })
			.click();
	});
	await step('resizing persists host-owned geometry across reload', async () => {
		const handle = hub.getByRole('button', { name: 'Resize Agent', exact: true });
		const before = await hub.boundingBox();
		expect(before).not.toBeNull();
		await handle.focus();
		await handle.press('ArrowLeft');
		await expect.poll(async () => (await hub.boundingBox())!.width).toBeLessThan(before!.width);
		const changed = await hub.boundingBox();
		hub = await openNativeTask(task);
		await expect.poll(async () => Math.abs((await hub.boundingBox())!.width - changed!.width)).toBeLessThan(2);
	});
	await step('create and switch threads in the UI and rename through the versioned workspace API', async () => {
		await openAgentConversations(page);
		const panel = hub.locator('#agent-thread-sidebar');
		const { result } = await captureNativeCommand(task, 'agent.threads.create', () =>
			panel.getByRole('button', { name: 'New', exact: true }).click(),
		);
		if (result.method !== 'agent.threads.create') {
			throw new Error('Unexpected thread creation');
		}
		expect(result.value.title).toBe('Untitled thread');
		await openAgentConversations(page);
		await expect(
			panel.getByRole('button').filter({ has: page.getByText('Untitled thread', { exact: true }) }),
		).toBeVisible();
		const renameResult = await requestAgentWorkspace(request, task.app, {
			method: 'agent.threads.rename',
			params: {
				threadId: result.value.id,
				expectedVersion: result.value.version,
				operationId: randomUUID(),
				title: 'Renamed plugin conversation',
			},
		});
		if (renameResult.method !== 'agent.threads.rename') {
			throw new Error('Unexpected thread rename');
		}
		expect(renameResult.value).toMatchObject({
			id: result.value.id,
			title: 'Renamed plugin conversation',
			version: result.value.version + 1,
		});
		await hub.getByRole('button', { name: 'Minimize Agent', exact: true }).click();
		await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
		await openAgentConversations(page);
		await expect(
			panel.getByRole('button').filter({ has: page.getByText('Renamed plugin conversation', { exact: true }) }),
		).toBeVisible();
		await panel
			.getByRole('button')
			.filter({ has: page.getByText(task.thread.title, { exact: true }) })
			.click();
		await expect(hub.getByText('OK', { exact: true })).toBeVisible();
	});
	await step(
		'old slash/checkpoint/delete APIs stay retired; plain prompts and follow-ups create real Runs',
		async () => {
			for (const suffix of ['/checkpoint', '/goal', '/plan']) {
				const response = await request.post(`/api/v1/apps/nexus.agent/threads/${task.thread.id}${suffix}`, {
					headers: { Origin: E2E_URLS.frontendOrigin },
					data: {},
				});
				expect(response.status()).toBe(404);
			}
			const original = await startNativeTask(task, '/status');
			expect((await finishNativeTask(task, original.id)).text).toBe('OK');
			const followup = await startNativeTask(task, 'E2E_NATIVE_PLUGIN_OK follow-up', [], true);
			expect(followup.id).not.toBe(original.id);
			expect((await finishNativeTask(task, followup.id)).run.status).toBe('completed');
			expect((await readNativeRun(task, original.id)).status).toBe('completed');
			const deleted = await request.delete(`/api/v1/apps/nexus.agent/runs/${original.id}`, {
				headers: { Origin: E2E_URLS.frontendOrigin },
			});
			expect(deleted.status()).toBe(404);
		},
	);
	await step('pending mutation approval is rendered and submits the original hash and version', async () => {
		const run = await startNativeTask(task, `E2E_NATIVE_PLUGIN_APPROVAL connection=${connectionId}`, [
			connectionId,
		]);
		try {
			const approval = await waitNativeApproval(task, run.id, 'shell_execute');
			const article = hub.locator('article').filter({ hasText: approval.inspection.summary });
			await expect(article).toContainText('shell_execute');
			await expect(article).toContainText('Destructive');
			const { command: input } = await captureNativeCommand(task, 'agent.approvals.resolve', () =>
				article.getByRole('button', { name: 'Approve and run', exact: true }).click(),
			);
			if (input.request.method !== 'agent.approvals.resolve') {
				throw new Error('Unexpected approval command');
			}
			expect(input.request.params.input).toMatchObject({
				expectedVersion: approval.version,
				operationHash: approval.operationHash,
				decision: 'approved',
			});
			const result = await finishNativeTask(task, run.id);
			expect(result.run.status).toBe('completed');
			expect(JSON.parse(result.text)).toMatchObject({ exitCode: 0, stdout: 'approval-e2e' });
			await article.getByText('Normalized operation', { exact: true }).click();
			await article.getByRole('button', { name: 'Inspect tool audit', exact: true }).click();
			await openNativeTaskPanel(page);
			const audit = hub
				.locator('details')
				.filter({ has: page.locator(':scope > summary').filter({ hasText: /^Step and tool audit$/ }) });
			await expect(audit).toHaveAttribute('open', '');
			await expect(audit).toContainText('shell_execute');
			await expect(audit).toContainText(approval.operationHash);
			await expect(audit).toContainText('printf approval-e2e');
		} finally {
			await cancelNativeTask(task, run.id);
		}
	});
	await step('protocol-invalid dispatched model tools remain unknown without a fabricated success', async () => {
		const run = await startNativeTask(task, 'E2E_NATIVE_PLUGIN_FAIL');
		const result = await finishNativeTask(task, run.id);
		// The provider stream was dispatched before the untrusted tool name was
		// discovered. The durable Run intentionally records an uncertain outcome
		// instead of claiming that all remote effects are proven to have failed.
		expect(result.run.status).toBe('unknown');
		expect(result.text).toBe('');
		await openNativeTaskPanel(page);
		await expect(hub.locator('strong').filter({ hasText: /^Unknown$/ })).toBeVisible();
		await hub
			.getByRole('complementary', { name: 'Tasks', exact: true })
			.getByRole('button', { name: 'Close', exact: true })
			.click();
	});
	await step(
		'uploaded Artifact appears in the actual App library and verified download preserves bytes',
		async () => {
			const bytes = Buffer.from('Plugin native Artifact evidence\n');
			// Upload belongs to the conversation attachment picker; the library
			// manages files that have already been published.
			await hub.getByRole('button', { name: /^Files \(\d+\)$/ }).click();
			const picker = page
				.locator('[data-ui="popover-panel"]')
				.filter({ has: page.locator('input[type="file"]') });
			await expect(picker).toBeVisible();
			await expect(picker.getByRole('button', { name: 'Upload', exact: true })).toBeEnabled();
			// Hub navigation can retire Chromium's CDP response body after a
			// successful PUT. Capture and decode the original request in the route
			// before allowing the UI to navigate; never replay this mutation.
			// The page fixture owns interception until teardown; background Host
			// polling must not race a network-pattern change after this receipt.
			const uploadRoute = `**/api/v1/agent/apps/${app.id}/artifacts/*/content`;
			let uploadedArtifactBody: unknown;
			let capturedArtifactBody = false;
			await page.route(uploadRoute, async (route) => {
				if (route.request().method() !== 'PUT') {
					await route.continue();
					return;
				}
				const upstream = await route.fetch();
				uploadedArtifactBody = await upstream.json();
				capturedArtifactBody = true;
				await route.fulfill({ response: upstream });
			});
			const publication = page.waitForResponse(
				(response) =>
					response.url().includes(`/agent/apps/${app.id}/artifacts/`) &&
					response.url().endsWith('/content') &&
					response.request().method() === 'PUT',
			);
			await picker.locator('input[type="file"]').setInputFiles({
				name: 'plugin-evidence.txt',
				mimeType: 'text/plain',
				buffer: bytes,
			});
			const uploaded = await publication;
			expect(uploaded.status()).toBe(200);
			expect(capturedArtifactBody).toBe(true);
			const artifact = readAgentArtifactResponse(uploadedArtifactBody).artifact;
			expect(artifact).toMatchObject({
				appId: app.id,
				name: 'plugin-evidence.txt',
				status: 'ready',
				sizeBytes: bytes.length,
				sha256: createHash('sha256').update(bytes).digest('hex'),
			});
			const attachmentSearch = picker.getByRole('searchbox', { name: 'Search files', exact: true });
			await expect(picker.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
			await attachmentSearch.fill('plugin-evidence.txt');
			await attachmentSearch.press('Enter');
			await expect(picker.getByRole('checkbox').filter({ hasText: 'plugin-evidence.txt' })).toBeChecked();
			await page.keyboard.press('Escape');
			await expect(picker).toBeHidden();
			await hub.getByRole('button', { name: 'Files', exact: true }).click();
			const library = hub.getByRole('region', { name: 'Files and Artifact library', exact: true });
			await selectUiOption(library.getByRole('combobox', { name: 'App', exact: true }), app.id);
			const search = library.getByRole('searchbox', { name: 'Search files', exact: true });
			await expect(search).toBeEnabled();
			await search.fill('plugin-evidence.txt');
			await search.press('Enter');
			const row = library
				.locator('article')
				.filter({ has: page.getByTitle('plugin-evidence.txt', { exact: true }) });
			await expect(row).toContainText(artifact.name);
			await expect(row).toContainText(String(artifact.sizeBytes));
			const downloading = page.waitForEvent('download');
			await row.getByRole('button', { name: 'Download', exact: true }).click();
			const download = await downloading;
			expect(download.suggestedFilename()).toBe('plugin-evidence.txt');
			expect(await download.failure()).toBeNull();
			expect(await readFile((await download.path())!)).toEqual(bytes);
			await captureFunctionalScreenshot(page, 'agent-installed-files.png', {
				viewport: { width: 1440, height: 900 },
			});
		},
	);
});
