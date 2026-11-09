import { agentChatSurface, agentHost } from './workbench';
import { hasApprovalIdentity } from '../../../support/package-tool-catalog.mjs';
import {
	readAgentPluginFrontendRpc,
	readAgentPluginRpcResponse,
} from '../../../../packages/shared/src/agent/plugins/frontend-rpc-codec';
import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '../fixtures';
import type { Route } from '@playwright/test';
import { loginAsInitialAdmin, setUiLanguage } from '../auth';
import { requestAgentJson } from '../agent-request';
import {
	openAgentConversations,
	openAgentHub,
	prepareAgentRun,
	createTestAgentApp,
	requestAgentWorkspace,
	selectAgentModel,
	selectAgentApp,
} from '../agent';
import { readAgentAppResponse } from '../../../../packages/shared/src/agent/scope/http-codec';
import { readAgentGrantView, readAgentApprovalView } from '../../../../packages/shared/src/agent/governance/http-codec';
import type { AgentApprovalView } from '../../../../packages/shared/src/agent/governance/model';
import {
	toolCommandPreview,
	toolSummaryTargetIds,
	toolDisplayName,
} from '../../../../packages/frontend/src/features/agent/runtime/native-tool-summary';
import {
	readAgentWorkspaceRequest,
	readAgentWorkspaceResponse,
} from '../../../../packages/shared/src/agent/scope/workspace-http-codec';
import type {
	AgentWorkspaceInput,
	AgentWorkspaceRequest,
	AgentWorkspaceResult,
} from '../../../../packages/shared/src/agent/scope/workspace-http';
import { AGENT_THREAD_ENTRY_MAX_PAGE, AGENT_THREAD_MAX_PAGE } from '../../../../packages/shared/src/agent/scope/values';
import type { AgentThreadEntry, AgentThreadEntryCursor } from '../../../../packages/shared/src/agent/scope/model';
import type { AgentAppView } from '../../../../packages/shared/src/agent/scope/model';
import type { AgentCapability } from '../../../../packages/shared/src/agent/governance/values';
import type { AgentRunView } from '../../../../packages/shared/src/agent/runs/model';

export async function prepareNativeTask(
	request: APIRequestContext,
	page: Page,
	capabilities: AgentCapability[] = [],
	connectionIds: number[] = [],
	existingApp?: AgentAppView,
	selectedRootIds?: string[],
) {
	await loginAsInitialAdmin(request);
	if (request !== page.request) {
		await loginAsInitialAdmin(page.request);
	}
	await setUiLanguage(page.request);
	let configuredApp = existingApp;
	if (!configuredApp && selectedRootIds) {
		configuredApp = await createTestAgentApp(request, undefined, { selectedRootIds, uiPackageId: 'nexus.ui.chat' });
	}
	const activeApp =
		configuredApp && !configuredApp.enabled
			? await requestAgentJson(
					request,
					{
						method: 'PATCH',
						path: '/apps/' + configuredApp.id,
						data: { enabled: true, expectedVersion: configuredApp.version },
					},
					readAgentAppResponse,
				)
			: configuredApp;
	const prepared = await prepareAgentRun(request, activeApp);
	if (capabilities.length) {
		const path = `/apps/${prepared.app.id}/grants`;
		const before = await requestAgentJson(request, { method: 'GET', path }, readAgentGrantView);
		await requestAgentJson(
			request,
			{
				method: 'PUT',
				path,
				data: {
					expectedPolicyRevision: before.policyRevision,
					grants: [...new Set<AgentCapability>(['plugin.invoke', ...capabilities])].map((capability) => {
						const definition = before.definitions.find((item) => item.id === capability);
						if (!definition) {
							throw new Error(`Capability unavailable: ${capability}`);
						}
						return {
							capability,
							scope:
								definition.scopeKind === 'global'
									? { kind: 'global' }
									: {
											kind: 'targets',
											targets: { ssh: { mode: 'ids', ids: connectionIds.map(String) } },
										},
						};
					}),
				},
			},
			readAgentGrantView,
		);
	}
	return { ...prepared, request, page };
}

export type NativeTask = Awaited<ReturnType<typeof prepareNativeTask>>;

export async function openNativeTask(task: NativeTask) {
	const { page, thread, provider } = task;
	await page.goto('/connections');
	const host = agentHost(page);
	const hub = agentChatSurface(page, task.app.id);
	await openAgentHub(page);
	await selectAgentApp(page, task.app);
	await expect(host.locator('iframe[data-agent-app-id="' + task.app.id + '"]')).toHaveAttribute(
		'sandbox',
		'allow-scripts allow-forms',
	);
	await openAgentConversations(page);
	const threads = hub.locator('#agent-thread-sidebar');
	let after: string | null = null;
	let selectedThread: { title: string; version: number } | undefined;
	for (;;) {
		const listed = await requestAgentWorkspace(task.request, task.app, {
			method: 'agent.threads.list',
			params: { after, limit: AGENT_THREAD_MAX_PAGE },
		});
		if (listed.method !== 'agent.threads.list') throw new Error('Unexpected thread list receipt');
		selectedThread = listed.value.items.find((item) => item.id === thread.id);
		if (selectedThread || listed.value.nextCursor === null) break;
		after = listed.value.nextCursor;
	}
	if (!selectedThread) throw new Error('Prepared Agent thread missing from its current App');
	const option = threads.getByRole('button').filter({ has: page.getByText(selectedThread.title, { exact: true }) });
	await expect(option).toHaveCount(1);
	await option.click();
	await selectAgentModel(page, provider);
	await expect(hub).toBeVisible();
	await expect(hub.getByRole('textbox', { name: 'Task input', exact: true })).toBeVisible();
	return hub;
}

type NativeCommandReceipt = {
	command: AgentWorkspaceRequest;
	result: AgentWorkspaceResult;
	authorization?: AgentApprovalView;
};

type NativeCommandCapture = {
	appId: string;
	appVersion: number;
	method: AgentWorkspaceInput['method'];
	receipt?: NativeCommandReceipt;
	claimed: boolean;
	dispatches: number;
};

type NativeCommandRouter = { active?: NativeCommandCapture; ready: Promise<void> };

const nativeCommandRouters = new WeakMap<Page, NativeCommandRouter>();

async function getNativeCommandRouter(page: Page): Promise<NativeCommandRouter> {
	const existing = nativeCommandRouters.get(page);
	if (existing) {
		await existing.ready;
		return existing;
	}
	// Keep one handler for the Page lifetime. Changing interception patterns
	// while a write or its follow-up reads are paused can resume them early.
	const router: NativeCommandRouter = { ready: Promise.resolve() };
	nativeCommandRouters.set(page, router);
	router.ready = page
		.route('**/agent/plugins/installations/*/frontend/rpc', async (route) => {
			const request = route.request();
			const active = router.active;
			if (
				!active ||
				request.method() !== 'POST' ||
				!request.url().endsWith(`/agent/plugins/installations/${active.appId}/frontend/rpc`)
			) {
				await route.fallback();
				return;
			}
			const rpc = readAgentPluginFrontendRpc(request.postDataJSON());
			if (rpc.envelope.request.method !== active.method) {
				await route.fallback();
				return;
			}
			active.dispatches += 1;
			if (active.claimed) {
				await route.fallback();
				return;
			}
			const command = readAgentWorkspaceRequest({ appVersion: active.appVersion, request: rpc.envelope.request });
			active.claimed = true;
			const upstream = await route.fetch({ maxRetries: 0 });
			expect(upstream.status()).toBe(200);
			const response = readAgentPluginRpcResponse(await upstream.json(), rpc.envelope);
			if (!response.ok) throw new Error('Expected successful original Agent RPC receipt');
			const workspace = readAgentWorkspaceResponse(
				{ appId: active.appId, appVersion: active.appVersion, result: response.result },
				active.appId,
				command,
			);
			active.receipt = { command, result: workspace.result };
			await route.fulfill({ response: upstream });
		})
		.then(() => undefined);
	await router.ready;
	return router;
}

/** Capture the original write receipt before the UI can navigate; never replay it. */
export async function captureNativeCommand(
	task: NativeTask,
	method: AgentWorkspaceInput['method'],
	action: () => Promise<void>,
): Promise<NativeCommandReceipt> {
	const router = await getNativeCommandRouter(task.page);
	if (router.active) throw new Error('An Agent command capture is already active on this Page');
	const active: NativeCommandCapture = {
		appId: task.app.id,
		appVersion: task.app.version,
		method,
		claimed: false,
		dispatches: 0,
	};
	router.active = active;
	let authorization: AgentApprovalView | undefined;
	const approvalPath = '**/api/v1/apps/' + task.app.id + '/approvals/*';

	const captureApproval = async (route: Route) => {
		if (route.request().method() !== 'GET') {
			await route.fallback();
			return;
		}
		const response = await route.fetch({ maxRetries: 0 });
		expect(response.status()).toBe(200);
		authorization = readAgentApprovalView(await response.json());
		expect(new URL(response.url()).pathname).toBe('/api/v1/apps/' + task.app.id + '/approvals/' + authorization.id);
		await route.fulfill({ response });
	};

	if (method === 'agent.approvals.resolve') await task.page.route(approvalPath, captureApproval);
	const approvalResponse =
		method === 'agent.approvals.resolve'
			? task.page.waitForResponse((response) => {
					const path = new URL(response.url()).pathname;
					return (
						response.request().method() === 'GET' &&
						response.frame() === task.page.mainFrame() &&
						path.startsWith('/api/v1/apps/' + task.app.id + '/approvals/') &&
						path.split('/').length === 7
					);
				})
			: undefined;
	const waiting = task.page.waitForResponse((response) => {
		if (
			!response.url().endsWith(`/agent/plugins/installations/${task.app.id}/frontend/rpc`) ||
			response.request().method() !== 'POST'
		) {
			return false;
		}
		return readAgentPluginFrontendRpc(response.request().postDataJSON()).envelope.request.method === method;
	});
	try {
		const [, response] = await Promise.all([
			Promise.all([action(), approvalResponse]).then(async ([, response]) => {
				if (method !== 'agent.approvals.resolve') return;
				if (!response) throw new Error('Missing original Host approval pre-read');
				expect(response.status()).toBe(200);
				if (!authorization) throw new Error('Missing original Host approval body');
				expect(new URL(response.url()).pathname).toBe(
					'/api/v1/apps/' + task.app.id + '/approvals/' + authorization.id,
				);
				expect(authorization.appId).toBe(task.app.id);
				expect(authorization.status).toBe('requested');
				const confirmation = task.page.getByRole('dialog', {
					name: 'Operation requires approval',
					exact: true,
				});
				await expect(confirmation).toBeVisible();
				const preview = toolCommandPreview(authorization.summary);
				if (preview) await expect(confirmation).toContainText(preview.text);
				await expect(confirmation.locator('[data-dialog-details]')).toContainText(
					toolDisplayName({ kind: 'host', operation: authorization.operationName }),
				);

				await expect(confirmation.locator('[data-dialog-details]')).toContainText(authorization.operationHash);
				const targets = toolSummaryTargetIds(authorization.summary);
				if (!targets.length && authorization.targetId !== null) targets.push(authorization.targetId);
				for (const target of targets)
					await expect(confirmation.locator('[data-dialog-details]')).toContainText(String(target));
				if (!targets.length) await expect(confirmation.locator('[data-dialog-details]')).toContainText('—');
				// The original resolve must remain undispatched until the trusted parent confirmation.
				expect(active.dispatches).toBe(0);
				await confirmation.getByRole('button', { name: /^(Approve and run|Reject once)$/ }).click();
			}),
			waiting,
		]);
		expect(response.status()).toBe(200);
		if (!active.receipt) throw new Error('Original Agent response was not captured');
		expect(active.dispatches).toBe(1);
		if (method === 'agent.approvals.resolve') {
			const command = active.receipt.command.request;
			if (!authorization || command.method !== 'agent.approvals.resolve')
				throw new Error('Missing original trusted approval authorization');
			expect(command.params.approvalId).toBe(authorization.id);
			expect(command.params.input.expectedVersion).toBe(authorization.version);
			expect(command.params.input.operationHash).toBe(authorization.operationHash);
		}
		return { ...active.receipt, ...(authorization ? { authorization } : {}) };
	} finally {
		router.active = undefined;
		if (method === 'agent.approvals.resolve') await task.page.unroute(approvalPath, captureApproval);
	}
}

export async function openNativeTaskPanel(page: Page): Promise<void> {
	const toggle = agentChatSurface(page).getByRole('button', { name: 'Show or hide task panel', exact: true });
	await expect(toggle).toBeVisible();
	if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
		await toggle.click();
	}
}

export async function startNativeTask(
	task: NativeTask,
	prompt: string,
	connectionIds: number[] = [],
	followUp = false,
) {
	const hub = agentChatSurface(task.page, task.app.id);
	const panel = hub.getByRole('complementary', { name: 'Tasks', exact: true });
	if (await panel.isVisible()) {
		await panel.getByRole('button', { name: 'Close', exact: true }).click();
	}
	await hub.getByRole('button', { name: 'Select SSH targets', exact: true }).click();
	const targets = hub
		.locator('fieldset')
		.filter({ has: task.page.locator('legend', { hasText: 'Select SSH targets' }) });
	await expect(targets).toBeVisible();
	const boxes = targets.getByRole('checkbox');
	for (let index = 0; index < (await boxes.count()); index++) {
		const box = boxes.nth(index);
		const checkboxId = await box.getAttribute('id');
		const selected = connectionIds.some((connectionId) => `agent-target-${connectionId}` === checkboxId);
		await box.setChecked(selected);
	}
	for (const connectionId of connectionIds) {
		await expect(targets.locator(`#agent-target-${connectionId}`)).toBeChecked();
	}
	await task.page.keyboard.press('Escape');
	await expect(targets).toBeHidden();
	await expect(hub).toBeVisible();
	await hub.getByRole('textbox', { name: 'Task input', exact: true }).fill(prompt);
	const send = hub.getByRole('button', { name: 'Send', exact: true });
	await expect(send).toBeEnabled();
	const hasRun = await hub.getByRole('button', { name: 'Show or hide task panel', exact: true }).isVisible();
	if (followUp) expect(hasRun).toBe(true);
	const method = hasRun ? 'agent.runs.appendInput' : 'agent.runs.create';
	const { command, result } = await captureNativeCommand(task, method, () => send.click());
	if (command.request.method === 'agent.runs.create' || command.request.method === 'agent.runs.appendInput') {
		expect(command.request.params.input.connectionIds).toEqual(connectionIds);
	}
	if (result.method !== 'agent.runs.create' && result.method !== 'agent.runs.appendInput') {
		throw new Error('Unexpected Run receipt');
	}
	expect(result.value.run.threadId).toBe(task.thread.id);
	return result.value.run;
}

export async function readNativeRun(task: NativeTask, runId: string): Promise<AgentRunView> {
	const result = await requestAgentWorkspace(task.request, task.app, { method: 'agent.runs.get', params: { runId } });
	if (result.method !== 'agent.runs.get' || !result.value) {
		throw new Error('Run not found');
	}
	return result.value;
}

/** Each scenario explicitly names allowed tools. Never turn a whole Run into full access. */
export async function finishNativeTask(task: NativeTask, runId: string, approvedTools: string[] = []) {
	await expect
		.poll(
			async () => {
				const approvals = await listNativeApprovalHistory(task, runId);
				for (const approval of approvals.filter((item) => item.status === 'requested')) {
					expect(
						approvedTools.some((name) => hasApprovalIdentity(approval, name)),
						`Unexpected approval: ${approval.operationName}`,
					).toBe(true);
					await requestAgentWorkspace(task.request, task.app, {
						method: 'agent.approvals.resolve',
						params: {
							approvalId: approval.id,
							operationId: randomUUID(),
							input: {
								decision: 'approved',
								expectedVersion: approval.version,
								operationHash: approval.operationHash,
							},
						},
					});
				}
				return (await readNativeRun(task, runId)).status;
			},
			// Each poll may approve the next governed operation. The default
			// escalating 1s interval adds latency to every approval/model turn.
			{ timeout: 45_000, intervals: [20, 50, 100] },
		)
		.toMatch(/^(completed|failed|unknown|cancelled)$/);
	const run = await readNativeRun(task, runId);
	const entries: AgentThreadEntry[] = [];
	let after: AgentThreadEntryCursor = { runSequence: 0, messageOrdinal: 0, chunkIndex: 0, textOffset: 0 };
	while (true) {
		const history = await requestAgentWorkspace(task.request, task.app, {
			method: 'agent.threads.entries',
			params: {
				threadId: task.thread.id,
				after,
				limit: AGENT_THREAD_ENTRY_MAX_PAGE,
			},
		});
		if (history.method !== 'agent.threads.entries') {
			throw new Error('Unexpected thread history');
		}
		if (!history.value.items.length) {
			const text = entries
				.filter((entry) => entry.runId === run.id && entry.role === 'assistant')
				.map((entry) => entry.text)
				.join('');
			return { run, text, entries };
		}
		expect(history.value.nextCursor).not.toEqual(after);
		entries.push(...history.value.items);
		after = history.value.nextCursor;
	}
}

export async function waitNativeApproval(task: NativeTask, runId: string, toolName: string) {
	let found: import('../../../../packages/shared/src/agent/governance/model').AgentApprovalView | undefined;
	await expect
		.poll(
			async () => {
				const result = await listNativeApprovalHistory(task, runId);
				found = result.find((item) => item.status === 'requested' && hasApprovalIdentity(item, toolName));
				return !!found;
			},
			{ intervals: [20, 50, 100] },
		)
		.toBe(true);
	if (!found) {
		throw new Error('Approval not found');
	}
	return found;
}

export async function resolveNativeApproval(
	task: NativeTask,
	approval: import('../../../../packages/shared/src/agent/governance/model').AgentApprovalView,
	decision: 'approved' | 'denied',
) {
	return requestAgentWorkspace(task.request, task.app, {
		method: 'agent.approvals.resolve',
		params: {
			approvalId: approval.id,
			operationId: randomUUID(),
			input: {
				decision,
				expectedVersion: approval.version,
				operationHash: approval.operationHash,
			},
		},
	});
}

export async function cancelNativeTask(task: NativeTask, runId: string) {
	const run = await readNativeRun(task, runId);
	if (run.status !== 'pending' && run.status !== 'running' && run.status !== 'unknown') {
		return;
	}
	await requestAgentWorkspace(task.request, task.app, {
		method: 'agent.runs.cancel',
		params: {
			runId,
			operationId: randomUUID(),
			expectedVersion: run.version,
		},
	});
}

async function listNativeApprovalHistory(task: NativeTask, runId: string) {
	const items: import('../../../../packages/shared/src/agent/governance/model').AgentApprovalView[] = [];
	let after: string | null = null;
	while (true) {
		const result = await requestAgentWorkspace(task.request, task.app, {
			method: 'agent.approvals.list',
			params: { runId, after },
		});
		if (result.method !== 'agent.approvals.list') throw new Error('Unexpected approval history page');
		items.push(...result.value.items);
		if (!result.value.hasMore) return items;
		after = result.value.nextCursor;
	}
}
