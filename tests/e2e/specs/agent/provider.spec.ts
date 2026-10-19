import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { createAgentProvider, requestAgentJson } from '../../support/agent';
import { E2E_URLS } from '../../support/test-env';
import {
	readAgentProviderView,
	readAgentProviderListResponse,
	readAgentDiscoveredModels,
	readAgentProviderTestResponse,
	readAgentProviderDeleteResponse,
	readAgentRegistryStatus,
} from '../../../../packages/shared/src/agent/providers/http-codec';

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
	await expect(
		panel.getByRole('heading', { name: 'Renamed local provider v' + provider.version, exact: true }),
	).toBeVisible();
	await expect(panel).not.toContainText('e2e-provider-secret');
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

test('Provider writes enforce trusted origin and expose finite safe failures without a legacy CSRF endpoint', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const provider = await createAgentProvider(request);
	const deniedHeaders: Record<string, string>[] = [
		{ Origin: 'https://cross-origin.invalid' },
		{ Origin: E2E_URLS.frontendOrigin, 'Sec-Fetch-Site': 'cross-site' },
	];
	for (const extraHeaders of deniedHeaders) {
		const rejected = await request.patch('/api/v1/agent/ai/providers/' + provider.id, {
			headers: extraHeaders,
			data: { expectedVersion: provider.version, displayName: 'Must not save' },
		});
		expect(rejected.status()).toBe(403);
		await expect(rejected.json()).resolves.toEqual({ code: 'csrf_rejected' });
	}
	const current = await requestAgentJson(
		request,
		{
			method: 'GET',
			path: '/ai/providers/' + provider.id,
		},
		readAgentProviderView,
	);
	expect(current.version).toBe(provider.version);
	expect(current.displayName).toBe(provider.displayName);
});

test('Registry is read without requiring public network refresh or invented model defaults', async ({ request }) => {
	await loginAsInitialAdmin(request);
	const status = await requestAgentJson(
		request,
		{
			method: 'GET',
			path: '/ai/model-registry',
		},
		readAgentRegistryStatus,
	);
	expect(status.sourceUrl).toBe('https://models.dev/api.json?type=all');
	// A clean database has no cache; reading does not fetch models.dev.
	expect(status.activeSource).toBe('unavailable');
	expect(status.entryCount).toBe(0);
	expect(status.lastAttemptAt).toBeNull();
});
