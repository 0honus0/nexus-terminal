import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

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

const providerBase = 'http://127.0.0.1:29091/v1';
const providerSecret = 'e2e-provider-secret';
const model = { id: 'e2e-model', contextWindow: 8192, maxOutputTokens: 128, supportsTools: true };

const csrfToken = async (request: APIRequestContext): Promise<string> => {
  const response = await request.get('/api/v1/agent/security/csrf');
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as Envelope<{ token: string }>).data.token;
};

test('Provider configuration protects credentials and enforces the OpenAI-compatible contract', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const csrf = await csrfToken(request);
  const headers = { 'X-Nexus-CSRF': csrf };

  let provider!: ProviderView;

  await step('configured model endpoints can be saved without a private-network exception list', async () => {
    const created = await request.post('/api/v1/agent/ai/providers', {
      headers,
      data: {
        kind: 'openai-compatible',
        displayName: 'E2E OpenAI Compatible',
        baseUrl: providerBase,
        protocol: 'chat-completions',
        credential: providerSecret,
        models: [model],
        enabled: true,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    provider = ((await created.json()) as Envelope<ProviderView>).data;
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

  await step('model discovery reads the upstream catalog without inventing capabilities', async () => {
    const discovered = await request.post(`/api/v1/agent/ai/providers/${provider.id}/discover-models`, {
      headers,
      data: {},
    });
    expect(discovered.ok(), await discovered.text()).toBeTruthy();
    await expect(discovered.json()).resolves.toMatchObject({
      data: [
        { id: 'e2e-model', ownedBy: 'nexus-e2e', createdAt: 1700000000 },
        { id: 'e2e-model-alt', ownedBy: 'nexus-e2e', createdAt: 1700000001 },
      ],
    });
    expect(JSON.stringify(await discovered.json())).not.toContain('contextWindow');
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
    await expect(failed.json()).resolves.toMatchObject({ data: { ok: false, errorCode: 'PROVIDER_AUTH_FAILED' } });

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
        data: { baseUrl: 'http://user:pass@127.0.0.1:29091/v1', expectedVersion: provider.version },
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
