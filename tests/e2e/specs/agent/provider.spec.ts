import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { addTaskProvider } from '../../fixtures/agent/task-ui';
import { step } from '../../support/steps';
import { E2E_URLS } from '../../support/test-env';

type Envelope<T> = { data: T; requestId: string };
type ProviderView = {
	id: string;
	kind: 'openai-compatible';
	displayName: string;
	baseUrl: string;
	protocol: 'chat-completions' | 'responses';
	hasCredential: boolean;
	credentialRevision: number;
	models: Array<{ id: string; contextWindow: number; maxOutputTokens: number; supportsTools: boolean }>;
	enabled: boolean;
	version: number;
};

const providerBase = `${E2E_URLS.openAiProviderOrigin}/v1`;
const providerSecret = 'e2e-provider-secret';
const model = { id: 'e2e-model', contextWindow: 8192, maxOutputTokens: 128, supportsTools: true };

const csrfToken = async (request: APIRequestContext): Promise<string> => {
	const response = await request.get('/api/v1/agent/security/csrf');
	expect(response.ok(), await response.text()).toBeTruthy();
	return ((await response.json()) as Envelope<{ token: string }>).data.token;
};

test('Provider configuration protects credentials and enforces the OpenAI-compatible contract', async ({
	request,
	page,
}) => {
	await loginAsInitialAdmin(request);
	await loginAsInitialAdmin(page.request);
	await setUiLanguage(page.request);
	const csrf = await csrfToken(request);
	const headers = { 'X-Nexus-CSRF': csrf };

	await step('Agent initialization loads remote model capabilities', async () => {
		const status = await request.get('/api/v1/agent/ai/model-registry');
		expect(status.ok(), await status.text()).toBeTruthy();
		const statusBody = (await status.json()) as Envelope<{
			sourceUrl: string;
			activeSource: 'remote' | 'unavailable';
			entryCount: number;
		}>;
		expect(statusBody.data.sourceUrl).toBe('https://models.dev/api.json?type=all');
		expect(statusBody.data.activeSource).toBe('remote');
		expect(statusBody.data.entryCount).toBeGreaterThan(100);

		for (const [modelId, contextWindow, maxOutputTokens] of [
			['gpt-5.6-sol', 1_050_000, 128_000],
			['gemini-3.8-flash-high', 1_048_576, 65_536],
			['claude-fable-5-1', 1_000_000, 128_000],
		] as const) {
			const resolved = await request.get('/api/v1/agent/ai/model-registry/resolve', { params: { modelId } });
			expect(resolved.ok(), await resolved.text()).toBeTruthy();
			await expect(resolved.json()).resolves.toMatchObject({
				data: { modelId, defaults: { contextWindow, maxOutputTokens, supportsTools: true } },
			});
		}
	});

	let provider!: ProviderView;

	await step('unsaved provider endpoint can discover models before configuration is created', async () => {
		const discovered = await request.post('/api/v1/agent/ai/providers/discover-endpoint-models', {
			headers,
			data: {
				baseUrl: providerBase,
				credential: providerSecret,
			},
		});
		expect(discovered.ok(), await discovered.text()).toBeTruthy();
		await expect(discovered.json()).resolves.toMatchObject({
			data: [
				{ id: 'e2e-model', ownedBy: 'nexus-e2e', createdAt: 1700000000 },
				{ id: 'e2e-model-alt', ownedBy: 'nexus-e2e', createdAt: 1700000001 },
			],
		});

		const directBackendOrigin = new URL(E2E_URLS.backendOrigin);
		directBackendOrigin.hostname = 'localhost';
		const directOrigin = directBackendOrigin.origin;
		const sameOriginDiscovery = await request.post(
			`${directOrigin}/api/v1/agent/ai/providers/discover-endpoint-models`,
			{
				headers: { ...headers, Origin: directOrigin },
				data: {
					baseUrl: providerBase,
					credential: providerSecret,
				},
			},
		);
		expect(sameOriginDiscovery.ok(), await sameOriginDiscovery.text()).toBeTruthy();

		const publicOriginDiscovery = await request.post('/api/v1/agent/ai/providers/discover-endpoint-models', {
			headers: { ...headers, Origin: E2E_URLS.frontendOrigin, 'Sec-Fetch-Site': 'same-origin' },
			data: { baseUrl: providerBase, credential: providerSecret },
		});
		expect(publicOriginDiscovery.ok(), await publicOriginDiscovery.text()).toBeTruthy();

		const mismatchedOrigin = await request.post(
			`${directOrigin}/api/v1/agent/ai/providers/discover-endpoint-models`,
			{
				headers: { ...headers, Origin: 'https://cross-origin.invalid' },
				data: {
					baseUrl: providerBase,
					credential: providerSecret,
				},
			},
		);
		expect(mismatchedOrigin.status()).toBe(403);
		await expect(mismatchedOrigin.json()).resolves.toMatchObject({ error: { code: 'CSRF_REJECTED' } });

		const crossSiteDiscovery = await request.post('/api/v1/agent/ai/providers/discover-endpoint-models', {
			headers: { ...headers, Origin: E2E_URLS.frontendOrigin, 'Sec-Fetch-Site': 'cross-site' },
			data: { baseUrl: providerBase, credential: providerSecret },
		});
		expect(crossSiteDiscovery.status()).toBe(403);
		await expect(crossSiteDiscovery.json()).resolves.toMatchObject({ error: { code: 'CSRF_REJECTED' } });
	});

	await step('configured model endpoints can be saved without a private-network exception list', async () => {
		provider = await addTaskProvider(page, 'E2E OpenAI Compatible');
		expect(provider).toMatchObject({
			kind: 'openai-compatible',
			displayName: 'E2E OpenAI Compatible',
			baseUrl: providerBase,
			protocol: 'chat-completions',
			hasCredential: true,
			credentialRevision: 1,
			enabled: true,
			version: 1,
		});
		const serialized = JSON.stringify(provider);
		expect(serialized).not.toContain(providerSecret);
		expect(serialized).not.toContain('protected_credential');
		expect(serialized).not.toContain('privateHostExceptions');
	});

	await step('model discovery ingests only explicit provider capability metadata', async () => {
		const discovered = await request.post(`/api/v1/agent/ai/providers/${provider.id}/discover-models`, {
			headers,
			data: {},
		});
		expect(discovered.ok(), await discovered.text()).toBeTruthy();
		const discoveredBody = (await discovered.json()) as Envelope<
			Array<{
				id: string;
				ownedBy?: string;
				createdAt?: number;
				providerCapabilities?: {
					source: string;
					sourceVersion: string;
					capabilities: Record<string, unknown>;
				};
			}>
		>;
		expect(discoveredBody.data[0]).toMatchObject({
			id: 'e2e-model',
			ownedBy: 'nexus-e2e',
			createdAt: 1700000000,
		});
		expect(discoveredBody.data[0]?.providerCapabilities).toBeUndefined();
		expect(discoveredBody.data[1]).toMatchObject({
			id: 'e2e-model-alt',
			ownedBy: 'nexus-e2e',
			createdAt: 1700000001,
			providerCapabilities: {
				source: expect.stringMatching(/^openai-compatible:[A-Za-z0-9_-]{43}:\/models:nexus_capabilities$/),
				sourceVersion: expect.stringMatching(/^schema-1:sha256:[A-Za-z0-9_-]{43}$/),
				capabilities: {
					contextWindow: 16_384,
					maxOutputTokens: 512,
					supportsTools: true,
					supportsImageInput: true,
					supportsFileInput: false,
					reasoning: {
						supportedEfforts: ['low', 'high'],
						defaultEffort: 'low',
						mandatory: false,
					},
				},
			},
		});
	});

	await step(
		'minimal Chat Completions provider test streams through the configured endpoint and reports usage',
		async () => {
			const tested = await request.post(`/api/v1/agent/ai/providers/${provider.id}/test`, {
				headers,
				data: { modelId: 'e2e-model' },
			});
			expect(tested.ok(), await tested.text()).toBeTruthy();
			await expect(tested.json()).resolves.toMatchObject({
				data: {
					ok: true,
					usage: { inputTokens: 5, outputTokens: 1, cachedInputTokens: 2 },
				},
			});
		},
	);

	await step('provider can switch to Responses while credential replacement preserves secret revisions', async () => {
		const renamed = await request.patch(`/api/v1/agent/ai/providers/${provider.id}`, {
			headers,
			data: { displayName: 'E2E Provider Renamed', expectedVersion: provider.version },
		});
		expect(renamed.ok(), await renamed.text()).toBeTruthy();
		provider = ((await renamed.json()) as Envelope<ProviderView>).data;
		expect(provider).toMatchObject({
			displayName: 'E2E Provider Renamed',
			hasCredential: true,
			credentialRevision: 1,
		});

		const switched = await request.patch(`/api/v1/agent/ai/providers/${provider.id}`, {
			headers,
			data: { protocol: 'responses', expectedVersion: provider.version },
		});
		expect(switched.ok(), await switched.text()).toBeTruthy();
		provider = ((await switched.json()) as Envelope<ProviderView>).data;
		expect(provider.protocol).toBe('responses');

		const responsesTest = await request.post(`/api/v1/agent/ai/providers/${provider.id}/test`, {
			headers,
			data: { modelId: 'e2e-model' },
		});
		expect(responsesTest.ok(), await responsesTest.text()).toBeTruthy();
		await expect(responsesTest.json()).resolves.toMatchObject({
			data: {
				ok: true,
				usage: { inputTokens: 5, outputTokens: 1, cachedInputTokens: 2 },
			},
		});

		const badCredential = await request.patch(`/api/v1/agent/ai/providers/${provider.id}`, {
			headers,
			data: { credential: 'wrong-e2e-secret', expectedVersion: provider.version },
		});
		expect(badCredential.ok(), await badCredential.text()).toBeTruthy();
		provider = ((await badCredential.json()) as Envelope<ProviderView>).data;
		expect(provider).toMatchObject({ hasCredential: true, credentialRevision: 2 });

		const failed = await request.post(`/api/v1/agent/ai/providers/${provider.id}/test`, {
			headers,
			data: { modelId: 'e2e-model' },
		});
		expect(failed.ok(), await failed.text()).toBeTruthy();
		await expect(failed.json()).resolves.toMatchObject({ data: { ok: false, errorCode: 'PROVIDER_HTTP_401' } });

		const restored = await request.patch(`/api/v1/agent/ai/providers/${provider.id}`, {
			headers,
			data: { credential: providerSecret, expectedVersion: provider.version },
		});
		expect(restored.ok(), await restored.text()).toBeTruthy();
		provider = ((await restored.json()) as Envelope<ProviderView>).data;
		expect(provider.credentialRevision).toBe(3);
	});

	await step(
		'provider endpoint validation rejects embedded URL credentials without changing the saved endpoint',
		async () => {
			const rejected = await request.patch(`/api/v1/agent/ai/providers/${provider.id}`, {
				headers,
				data: {
					baseUrl: providerBase.replace('http://', 'http://user:pass@'),
					expectedVersion: provider.version,
				},
			});
			expect(rejected.status(), await rejected.text()).toBe(400);
			await expect(rejected.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

			const current = await request.get('/api/v1/agent/ai/providers');
			expect(current.ok(), await current.text()).toBeTruthy();
			const listed = ((await current.json()) as Envelope<ProviderView[]>).data;
			provider = listed.find((candidate) => candidate.id === provider.id)!;
			expect(provider.baseUrl).toBe(providerBase);
		},
	);

	await step('explicit clear and deletion remove credentials without exposing them', async () => {
		const cleared = await request.patch(`/api/v1/agent/ai/providers/${provider.id}`, {
			headers,
			data: { clearCredential: true, expectedVersion: provider.version },
		});
		expect(cleared.ok(), await cleared.text()).toBeTruthy();
		provider = ((await cleared.json()) as Envelope<ProviderView>).data;
		expect(provider.hasCredential).toBe(false);
		expect(provider.credentialRevision).toBe(4);

		const removed = await request.delete(
			`/api/v1/agent/ai/providers/${provider.id}?expectedVersion=${provider.version}`,
			{
				headers,
			},
		);
		expect(removed.ok(), await removed.text()).toBeTruthy();
		await expect(removed.json()).resolves.toMatchObject({ data: { deleted: true } });

		const listed = await request.get('/api/v1/agent/ai/providers');
		expect(listed.ok(), await listed.text()).toBeTruthy();
		await expect(listed.json()).resolves.toMatchObject({ data: [] });
	});
});
