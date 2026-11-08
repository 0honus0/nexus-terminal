import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { requestAgentJson } from '../../support/agent-request';
import { createAgentProvider } from '../../support/agent';
import { E2E_URLS } from '../../../support/protocols/test-environment';
import { expectReadableCatalogText } from '../../support/catalog-colors';
import {
	readAgentProviderView,
	readAgentProviderListResponse,
	readAgentDiscoveredModels,
	readAgentProviderTestResponse,
	readAgentProviderDeleteResponse,
	readAgentRegistryStatus,
} from '../../../../packages/shared/src/agent/providers/http-codec';

test.use({ e2eServices: ['plugins', 'provider'] });

const headers = { Origin: E2E_URLS.frontendOrigin };

test('Provider credentials, observations and original configuration versions use the Shared contract', async ({
	request,
	page,
}) => {
	await loginAsInitialAdmin(request);
	await loginAsInitialAdmin(page.request);
	await setUiLanguage(page.request);
	let provider = await createAgentProvider(request);
	expect(provider).toMatchObject({ hasCredential: true, credentialRevision: 1, version: 1 });
	expect(JSON.stringify(provider)).not.toContain('e2e-provider-secret');
	expect(provider).not.toHaveProperty('credential');

	const discovered = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/ai/providers/' + provider.id + '/discover-models',
			data: {},
		},
		readAgentDiscoveredModels,
	);
	expect(discovered.map((item) => item.id)).toEqual(['e2e-model', 'e2e-model-alt']);
	expect(discovered[0].providerCapabilities).toBeUndefined();
	expect(discovered[1].providerCapabilities).toMatchObject({ contextWindow: 16384, supportsTools: true });
	provider = await requestAgentJson(
		request,
		{
			method: 'GET',
			path: '/ai/providers/' + provider.id,
		},
		readAgentProviderView,
	);
	const tested = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/ai/providers/' + provider.id + '/test',
			data: { modelId: 'e2e-model' },
		},
		readAgentProviderTestResponse,
	);
	expect(tested.ok).toBe(true);
	expect(tested.latencyMs).toBeGreaterThanOrEqual(0);

	const originalVersion = provider.version;
	provider = await requestAgentJson(
		request,
		{
			method: 'PATCH',
			path: '/ai/providers/' + provider.id,
			data: { expectedVersion: originalVersion, displayName: 'Renamed local provider' },
		},
		readAgentProviderView,
	);
	expect(provider.version).toBe(originalVersion + 1);
	expect(provider.credentialRevision).toBe(1);
	const stale = await request.patch('/api/v1/agent/ai/providers/' + provider.id, {
		headers,
		data: { expectedVersion: originalVersion, displayName: 'Stale update' },
	});
	expect(stale.status()).toBe(409);
	await expect(stale.json()).resolves.toEqual({ code: 'version_conflict' });

	await page.goto('/settings?tab=agent');
	const panel = page.getByRole('region', { name: 'Model providers', exact: true });
	await expect(panel.getByRole('heading', { name: 'Renamed local provider', exact: true })).toBeVisible();
	await expect(panel).not.toContainText('e2e-provider-secret');
	await expectReadableCatalogText(panel.locator('.ui-catalog-status-badge'));
	provider = await requestAgentJson(
		request,
		{
			method: 'PATCH',
			path: '/ai/providers/' + provider.id,
			data: { expectedVersion: provider.version, clearCredential: true },
		},
		readAgentProviderView,
	);
	expect(provider.hasCredential).toBe(false);
	expect(provider.credentialRevision).toBe(2);
	const removed = await requestAgentJson(
		request,
		{
			method: 'DELETE',
			path: '/ai/providers/' + provider.id + '?expectedVersion=' + provider.version,
		},
		readAgentProviderDeleteResponse,
	);
	expect(removed.deleted).toBe(true);
	expect(
		await requestAgentJson(request, { method: 'GET', path: '/ai/providers' }, readAgentProviderListResponse),
	).toEqual([]);
});

test('expanded Provider model IDs remain readable and selectable on narrow screens', async ({ page, request }) => {
	await loginAsInitialAdmin(request);
	await loginAsInitialAdmin(page.request);
	await setUiLanguage(page.request);
	const modelId = 'organization/' + 'long-model-identifier-'.repeat(12) + 'final';
	const provider = await requestAgentJson(
		request,
		{
			method: 'POST',
			path: '/ai/providers',
			status: 201,
			data: {
				kind: 'openai-compatible',
				displayName: 'Long model ID review',
				baseUrl: E2E_URLS.openAiProviderOrigin + '/v1',
				protocol: 'chat-completions',
				models: [{ id: modelId, contextWindow: 131072, maxOutputTokens: 128, supportsTools: true }],
				enabled: true,
			},
		},
		readAgentProviderView,
	);
	await page.goto('/settings?tab=agent');
	const card = page.getByRole('article').filter({ hasText: provider.displayName });
	await card.locator('summary').click();
	const model = card.getByText(modelId, { exact: true });
	for (const width of [320, 390, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await expect(model).toBeVisible();
		const selection = await model.evaluate((element) => {
			const range = document.createRange();
			range.selectNodeContents(element);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			return {
				text: selection?.toString(),
				selectable: getComputedStyle(element).userSelect,
				fits: element.scrollWidth <= element.clientWidth + 1,
			};
		});
		expect(selection).toEqual({ text: modelId, selectable: 'text', fits: true });
	}
});
