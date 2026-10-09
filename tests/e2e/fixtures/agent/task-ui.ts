import { expect, type Page } from '../../support/fixtures';
import { E2E_URLS } from '../../support/test-env';

export async function addTaskProvider(page: Page, displayName: string, modelId = 'e2e-model') {
	await page.goto('/settings?tab=agent');
	await page.getByRole('button', { name: 'Add provider', exact: true }).first().click();
	const dialog = page.getByRole('dialog', { name: 'Add Model Provider', exact: true });
	await dialog.getByLabel('Display name', { exact: false }).first().fill(displayName);
	await dialog
		.getByLabel('Base URL', { exact: false })
		.first()
		.fill(E2E_URLS.openAiProviderOrigin + '/v1');
	await dialog.getByLabel('Credential', { exact: false }).first().fill('e2e-provider-secret');
	await dialog.getByRole('textbox', { name: 'Model ID *', exact: true }).fill(modelId);
	await dialog.getByLabel('Context window', { exact: false }).first().fill('8192');
	await dialog.getByLabel('Maximum output tokens', { exact: false }).first().fill('128');
	const response = page.waitForResponse(
		(item) => item.url().endsWith('/agent/ai/providers') && item.request().method() === 'POST',
	);
	await dialog.getByRole('button', { name: 'Save & Add', exact: true }).click();
	const created = await response;
	expect(created.status()).toBe(201);
	await expect(dialog).toHaveCount(0);
	return (await created.json()).data;
}

export async function createTaskThread(page: Page) {
	await page.goto('/connections');
	const hub = page.getByRole('dialog', { name: 'Agent', exact: true });
	if (!(await hub.isVisible())) await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
	const response = page.waitForResponse(
		(item) => item.url().endsWith('/apps/nexus.agent/threads') && item.request().method() === 'POST',
	);
	await hub.getByRole('button', { name: 'New', exact: true }).click();
	const created = await response;
	expect(created.status()).toBe(201);
	return created;
}

export async function addProviderModel(page: Page, modelId: string) {
	const input = page.getByPlaceholder('Add custom model ID manually', { exact: true });
	if (!(await input.isVisible())) await page.getByRole('button', { name: 'Update models', exact: true }).click();
	await input.fill(modelId);
	await input.locator('xpath=..').getByRole('button', { name: 'Add model', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Model capabilities', exact: true });
	await dialog.getByLabel('Context window', { exact: true }).fill('8192');
	await dialog.getByLabel('Maximum output tokens', { exact: true }).fill('128');
	const response = page.waitForResponse(
		(item) => item.url().includes('/agent/ai/providers/') && item.request().method() === 'PATCH',
	);
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	const saved = await response;
	expect(saved.ok()).toBe(true);
	await expect(dialog).toHaveCount(0);
	return (await saved.json()).data;
}

export async function taskCommand(page: Page, text: string, endpoint: string) {
	await page.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...').fill(text);
	const response = page.waitForResponse(
		(item) => item.url().endsWith(endpoint) && item.request().method() === 'POST',
	);
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	return response;
}

export async function sendTask(
	page: Page,
	body: {
		schemaVersion?: number;
		agentDefinitionId?: string;
		threadId: string;
		input: { text: string; artifactRefs?: unknown[] };
		model: { modelId: string; providerId?: string; configurationVersion?: number };
		approvalMode: string;
		executionMode: string;
		connectionIds: number[];
	},
) {
	await page.goto('/connections');
	const hub = page.getByRole('dialog', { name: 'Agent', exact: true });
	if (!(await hub.isVisible())) await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
	await hub
		.getByRole('button')
		.filter({ hasText: `#${body.threadId.slice(-6)}` })
		.click();
	await hub.getByRole('button', { name: 'Model', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Model', exact: true })
		.getByRole('button')
		.filter({ has: page.getByText(body.model.modelId, { exact: true }) })
		.click();
	await hub.getByRole('button', { name: 'Approval mode', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Approval mode', exact: true })
		.getByRole('button', { name: body.approvalMode === 'ask' ? /^Ask when needed/ : /^Full access/ })
		.click();
	await hub.getByRole('button', { name: 'Execution mode', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Execution mode', exact: true })
		.getByRole('button', { name: body.executionMode === 'plan' ? /^Plan only/ : /^Execute/ })
		.click();
	await hub.getByRole('button', { name: 'SSH Hosts', exact: true }).click();
	const targets = page.getByRole('dialog', { name: 'SSH Hosts', exact: true });
	const all = targets.getByRole('checkbox');
	if (await all.count()) {
		if (body.connectionIds.length) await all.check();
		else await all.uncheck();
	}
	await page.keyboard.press('Escape');
	await hub.getByPlaceholder('Ask Agent to inspect, diagnose, or explain...').fill(body.input.text);
	const response = page.waitForResponse(
		(item) => item.url().endsWith('/apps/nexus.agent/runs') && item.request().method() === 'POST',
	);
	await hub.getByRole('button', { name: 'Send', exact: true }).click();
	const created = await response;
	if (created.status() === 201) {
		const run = (await created.json()).data;
		expect(run.threadId).toBe(body.threadId);
		expect(run.definition.model).toMatchObject(body.model);
		expect(run.definition.connectionIds).toEqual(body.connectionIds);
		expect(run.definition.approvalMode).toBe(body.approvalMode);
		expect(run.definition.executionMode).toBe(body.executionMode);
	}
	return created;
}
