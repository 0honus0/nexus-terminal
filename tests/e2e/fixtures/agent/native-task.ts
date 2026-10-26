import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import {
	openAgentConversations,
	openAgentHub,
	prepareAgentRun,
	requestAgentJson,
	requestAgentWorkspace,
	selectAgentModel,
} from '../../support/agent';
import { readAgentAppResponse } from '../../../../packages/shared/src/agent/scope/http-codec';
import { readAgentGrantView } from '../../../../packages/shared/src/agent/governance/http-codec';
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
) {
	await loginAsInitialAdmin(request);
	if (request !== page.request) {
		await loginAsInitialAdmin(page.request);
	}
	await setUiLanguage(page.request);
	const activeApp =
		existingApp && !existingApp.enabled
			? await requestAgentJson(
					request,
					{
						method: 'PATCH',
						path: '/apps/' + existingApp.id,
						data: { enabled: true, expectedVersion: existingApp.version },
					},
					readAgentAppResponse,
				)
			: existingApp;
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
					grants: capabilities.map((capability) => {
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
	const hub = page.getByRole('dialog', { name: 'Agent', exact: true });
	await openAgentHub(page);
	await hub.getByRole('button', { name: 'Choose an Agent app', exact: true }).click();
	await page
		.locator('[data-agent-hub-portal]')
		.getByRole('button')
		.filter({ has: page.getByText(task.app.name, { exact: true }) })
		.click();
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

type NativeCommandReceipt = { command: AgentWorkspaceRequest; result: AgentWorkspaceResult };

type NativeCommandCapture = {
	appId: string;
	method: AgentWorkspaceInput['method'];
	receipt?: NativeCommandReceipt;
	claimed: boolean;
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
		.route('**/agent/apps/*/workspace', async (route) => {
			const request = route.request();
			const active = router.active;
			if (
				!active ||
				active.claimed ||
				request.method() !== 'POST' ||
				!request.url().endsWith(`/agent/apps/${active.appId}/workspace`)
			) {
				await route.fallback();
				return;
			}
			const command = readAgentWorkspaceRequest(request.postDataJSON());
			if (command.request.method !== active.method) {
				await route.fallback();
				return;
			}
			active.claimed = true;
			const upstream = await route.fetch({ maxRetries: 0 });
			expect(upstream.status()).toBe(200);
			const response = readAgentWorkspaceResponse(await upstream.json(), active.appId, command);
			active.receipt = { command, result: response.result };
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
	const active: NativeCommandCapture = { appId: task.app.id, method, claimed: false };
	router.active = active;
	const waiting = task.page.waitForResponse((response) => {
		if (
			!response.url().endsWith(`/agent/apps/${task.app.id}/workspace`) ||
			response.request().method() !== 'POST'
		) {
			return false;
		}
		return readAgentWorkspaceRequest(response.request().postDataJSON()).request.method === method;
	});
	try {
		const [, response] = await Promise.all([action(), waiting]);
		expect(response.status()).toBe(200);
		if (!active.receipt) throw new Error('Original Agent response was not captured');
		return active.receipt;
	} finally {
		router.active = undefined;
	}
}

export async function openNativeTaskPanel(page: Page): Promise<void> {
	const toggle = page.getByRole('button', { name: 'Show or hide task panel', exact: true });
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
	const hub = task.page.getByRole('dialog', { name: 'Agent', exact: true });
	const panel = hub.getByRole('complementary', { name: 'Tasks', exact: true });
	if (await panel.isVisible()) {
		await panel.getByRole('button', { name: 'Close', exact: true }).click();
	}
	await hub.getByRole('button', { name: 'Select SSH targets', exact: true }).click();
	const targets = task.page
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
					expect(approvedTools, `Unexpected approval: ${approval.inspection.toolName}`).toContain(
						approval.inspection.toolName,
					);
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
			{ timeout: 45_000 },
		)
		.toMatch(/^(completed|failed|unknown|cancelled)$/);
	const run = await readNativeRun(task, runId);
	const entries: AgentThreadEntry[] = [];
	let after: AgentThreadEntryCursor = { runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 };
	for (let page = 0; page < 128; page++) {
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
	throw new Error('Functional fixture history exceeded its bounded review window');
}

export async function waitNativeApproval(task: NativeTask, runId: string, toolName: string) {
	let found: import('../../../../packages/shared/src/agent/governance/model').AgentApprovalView | undefined;
	await expect
		.poll(async () => {
			const result = await listNativeApprovalHistory(task, runId);
			found = result.find((item) => item.status === 'requested' && item.inspection.toolName === toolName);
			return !!found;
		})
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
