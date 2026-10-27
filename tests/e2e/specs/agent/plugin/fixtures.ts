import { readAgentBrowserConfiguration } from '../../../../../packages/shared/src/agent/integrations/browser-http-codec';
import { resolveNativeApproval, type NativeTask } from '../../../fixtures/agent/native-task';
import { requestAgentJson, requestAgentWorkspace } from '../../../support/agent';
import { readAgentAppResponse } from '../../../../../packages/shared/src/agent/scope/http-codec';
import { expect, type APIRequestContext, type Page } from '../../../support/fixtures';
import { E2E_URLS } from '../../../support/test-env';

export async function enablePluginApp(request: APIRequestContext, appId: string) {
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

export async function cancelBrowserPhase<T>(
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

export async function configureLifecycleBrowser(request: APIRequestContext) {
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

export async function browserControl(path: string, method: 'GET' | 'POST' = 'GET') {
	const response = await fetch(E2E_URLS.browserControlOrigin + path, { method });
	expect(response.ok).toBe(true);
	return response.json();
}

export async function releaseBrowserCreationBarrier(): Promise<void> {
	// The release fixture intentionally responds 200 with no JSON body.
	const response = await fetch(E2E_URLS.browserControlOrigin + '/creation-barrier/release', { method: 'POST' });
	expect(response.ok).toBe(true);
	expect(await response.text()).toBe('');
}

export async function releaseBrowserModel() {
	const response = await fetch(E2E_URLS.openAiProviderOrigin + '/browser-lifecycle/release', { method: 'POST' });
	expect(response.ok).toBe(true);
}

export async function nativeChildren(task: NativeTask, runId: string) {
	const result = await requestAgentWorkspace(task.request, task.app, {
		method: 'agent.subagents.list',
		params: { runId },
	});
	if (result.method !== 'agent.subagents.list') {
		throw new Error('Unexpected Child list');
	}
	return result.value.items;
}

export async function approveNativeFamily(task: NativeTask, runId: string, allowed: string[]) {
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

export const repositoryUrl = `${E2E_URLS.pluginRepositoryOrigin}/catalog.json`;

export const openAgentHub = async (page: Page) => {
	const hub = page.getByRole('dialog', { name: 'Agent', exact: true });
	const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
	await expect.poll(async () => (await hub.isVisible()) || (await launcher.isVisible())).toBe(true);
	if (!(await hub.isVisible())) {
		await launcher.click();
	}
	await expect(hub).toBeVisible();
	return hub;
};
