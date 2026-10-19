import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { prepareAgentRun, requestAgentJson, requestAgentWorkspace } from '../../support/agent';
import { readAgentAppResponse } from '../../../../packages/shared/src/agent/scope/http-codec';
import { readAgentGrantView } from '../../../../packages/shared/src/agent/governance/http-codec';
import {
	readAgentWorkspaceRequest,
	readAgentWorkspaceResponse,
} from '../../../../packages/shared/src/agent/scope/workspace-http-codec';
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
	const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
	await expect.poll(async () => (await hub.isVisible()) || (await launcher.isVisible())).toBe(true);
	if (!(await hub.isVisible())) {
		await launcher.click();
	}
	await expect(hub).toBeVisible();
	await hub.getByRole('button', { name: 'Choose an Agent app', exact: true }).click();
	await page
		.locator('[data-agent-hub-portal]')
		.getByRole('button')
		.filter({ has: page.getByText(task.app.id, { exact: true }) })
		.click();
	const threads = hub.getByRole('heading', { name: 'Native threads', exact: true }).locator('..');
	await threads.getByRole('button', { name: 'Read current threads', exact: true }).click();
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
	const option = threads.getByRole('button', {
		name: `${selectedThread.title} · v${selectedThread.version}`,
		exact: true,
	});
	await expect(option).toHaveCount(1);
	await option.click();
	await hub
		.getByRole('combobox', { name: 'Model for this execution', exact: true })
		.selectOption(JSON.stringify([provider.id, 'e2e-model', provider.version]));
	return hub;
}

export async function startNativeTask(
	task: NativeTask,
	prompt: string,
	connectionIds: number[] = [],
	followUp = false,
) {
	const hub = task.page.getByRole('dialog', { name: 'Agent', exact: true });
	const targets = hub.locator('fieldset').filter({ has: task.page.locator('legend') });
	const boxes = targets.getByRole('checkbox');
	for (let index = 0; index < (await boxes.count()); index++) {
		const box = boxes.nth(index);
		await box.setChecked(connectionIds.includes(Number(await box.getAttribute('value'))));
	}
	await hub.getByRole('textbox', { name: 'Task input', exact: true }).fill(prompt);
	const method = followUp ? 'agent.runs.appendInput' : 'agent.runs.create';
	const workspaceUrl = `**/agent/apps/${task.app.id}/workspace`;
	let captured: unknown;
	let didCapture = false;
	// The Agent UI can navigate away on an accepted Run while the browser is
	// still handing the POST response to DevTools. Capture the *same* request's
	// real response before fulfilling it; never replay an Agent write to read
	// its receipt after navigation.
	await task.page.route(workspaceUrl, async (route) => {
		const request = route.request();
		if (request.method() !== 'POST' || request.postDataJSON().request?.method !== method) {
			await route.continue();
			return;
		}
		const upstream = await route.fetch();
		captured = await upstream.json();
		didCapture = true;
		await route.fulfill({ response: upstream });
	});
	const waiting = task.page.waitForResponse((response) => {
		if (
			!response.url().endsWith(`/agent/apps/${task.app.id}/workspace`) ||
			response.request().method() !== 'POST'
		) {
			return false;
		}
		return response.request().postDataJSON().request?.method === method;
	});
	try {
		await hub
			.getByRole('button', { name: followUp ? 'Follow up this terminal Run' : 'Create a new Run', exact: true })
			.click();
		const response = await waiting;
		expect(response.status()).toBe(200);
		expect(didCapture, 'Browser forwarded the original Agent response').toBe(true);
		const command = readAgentWorkspaceRequest(response.request().postDataJSON());
		const result = readAgentWorkspaceResponse(captured, task.app.id, command).result;
		if (result.method !== 'agent.runs.create' && result.method !== 'agent.runs.appendInput') {
			throw new Error('Unexpected Run receipt');
		}
		expect(result.value.run.threadId).toBe(task.thread.id);
		return result.value.run;
	} finally {
		await task.page.unroute(workspaceUrl);
	}
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
				const approvals = await requestAgentWorkspace(task.request, task.app, {
					method: 'agent.approvals.list',
					params: { runId },
				});
				if (approvals.method !== 'agent.approvals.list') {
					throw new Error('Unexpected approval list');
				}
				for (const approval of approvals.value.filter((item) => item.status === 'requested')) {
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
			const result = await requestAgentWorkspace(task.request, task.app, {
				method: 'agent.approvals.list',
				params: { runId },
			});
			if (result.method !== 'agent.approvals.list') {
				throw new Error('Unexpected approval list');
			}
			found = result.value.find((item) => item.status === 'requested' && item.inspection.toolName === toolName);
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
