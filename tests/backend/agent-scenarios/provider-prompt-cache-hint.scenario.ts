import assert from 'node:assert/strict';
import { OpenAiProviderAdapter } from '../../../packages/backend/src/infrastructure/agent/providers/openai-provider.adapter';
import type { ModelRequest, TokenUsage } from '../../../packages/backend/src/modules/agent/ai/model.types';

export const providerPromptCacheHintScenario = async () => {
  const capturedBodies: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  const chatStreamBody = [
    'data: {"id":"chatcmpl-cache-1","created":1,"model":"gpt-5.6-sol","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}',
    '',
    'data: {"id":"chatcmpl-cache-1","created":1,"model":"gpt-5.6-sol","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":120,"completion_tokens":4,"total_tokens":124,"prompt_tokens_details":{"cached_tokens":80}}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  const responsesStreamBody = [
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","item_id":"msg_cache_1","output_index":0,"delta":"ok","logprobs":null}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"incomplete_details":null,"usage":{"input_tokens":140,"output_tokens":5,"total_tokens":145,"input_tokens_details":{"cached_tokens":96,"cache_write_tokens":null,"orchestration_input_tokens":null,"orchestration_input_cached_tokens":null},"output_tokens_details":{"reasoning_tokens":0,"orchestration_output_tokens":null}},"reasoning":null,"service_tier":null}}',
    '',
    '',
  ].join('\n');
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const bodyText =
      typeof init?.body === 'string'
        ? init.body
        : init?.body instanceof Uint8Array
          ? Buffer.from(init.body).toString('utf8')
          : '';
    capturedBodies.push({ url, body: bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {} });
    return new Response(url.endsWith('/responses') ? responsesStreamBody : chatStreamBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;

  const baseModel = {
    id: 'gpt-5.6-sol',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: true,
    supportsPromptCacheKey: true,
    capabilitySources: {
      contextWindow: 'registry',
      maxOutputTokens: 'registry',
      supportsTools: 'registry',
      supportsImageInput: 'registry',
      supportsFileInput: 'registry',
      supportsPromptCacheKey: 'registry',
    },
  };
  const providers = new Map<string, Record<string, unknown>>([
    [
      'official-chat',
      {
        id: 'official-chat',
        kind: 'openai-compatible',
        displayName: 'Official OpenAI Chat',
        baseUrl: 'https://api.openai.com/v1',
        protocol: 'chat-completions',
        hasCredential: true,
        credentialRevision: 1,
        models: [baseModel, { ...baseModel, id: 'gpt-5.6-terra' }],
        enabled: true,
        version: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    [
      'official-responses',
      {
        id: 'official-responses',
        kind: 'openai-compatible',
        displayName: 'Official OpenAI Responses',
        baseUrl: 'https://api.openai.com/v1',
        protocol: 'responses',
        hasCredential: true,
        credentialRevision: 1,
        models: [baseModel],
        enabled: true,
        version: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    [
      'custom-responses',
      {
        id: 'custom-responses',
        kind: 'openai-compatible',
        displayName: 'Custom Reasoning Responses',
        baseUrl: 'https://compat.example/v1',
        protocol: 'responses',
        hasCredential: true,
        credentialRevision: 1,
        models: [
          {
            ...baseModel,
            id: 'proxy-reasoner',
            reasoningEfforts: ['low', 'high'],
            defaultReasoningEffort: 'high',
          },
        ],
        enabled: true,
        version: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    [
      'third-party',
      {
        id: 'third-party',
        kind: 'openai-compatible',
        displayName: 'Compatible Proxy',
        baseUrl: 'https://compat.example/v1',
        protocol: 'chat-completions',
        hasCredential: true,
        credentialRevision: 1,
        models: [baseModel],
        enabled: true,
        version: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  ]);
  const adapter = new OpenAiProviderAdapter(
    {
      get: async (_userId: number, providerId: string) => providers.get(providerId) as never,
    },
    {
      withCredential: async <T>(
        _userId: number,
        _providerId: string,
        _credentialRevision: number,
        use: (credential: string | null) => Promise<T>,
      ) => use('scenario-key'),
    },
  );

  const capabilitySnapshot = {
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: true,
    supportsPromptCacheKey: true,
  } as ModelRequest['capabilitySnapshot'] & { supportsPromptCacheKey: boolean };
  const requestFor = (providerId: string, modelId = 'gpt-5.6-sol', lineageKey = 'stable-prefix-v1'): ModelRequest => ({
    userId: 1,
    providerId,
    modelId,
    configurationVersion: 1,
    instructions: ['Stable system instruction.'],
    messages: [{ role: 'user', content: 'volatile user turn' }],
    cache: {
      scopeKey: 'nexus:thread:RAW_THREAD_IDENTIFIER_12345',
      affinityKey: 'nexus:thread:RAW_THREAD_IDENTIFIER_12345',
      lineageKey,
    } as ModelRequest['cache'] & { lineageKey: string },
    capabilitySnapshot,
    maxOutputTokens: 64,
  });
  const streamOnce = async (request: ModelRequest): Promise<TokenUsage | undefined> => {
    let usage: TokenUsage | undefined;
    for await (const event of adapter.stream(request, new AbortController().signal)) {
      if (event.type === 'usage') usage = event.usage;
    }
    return usage;
  };

  try {
    const firstUsage = await streamOnce(requestFor('official-chat'));
    const firstBody = capturedBodies.at(-1)?.body ?? {};
    const firstKey = firstBody.prompt_cache_key;
    assert.equal(typeof firstKey, 'string', 'supported official OpenAI request must carry a provider prompt_cache_key');
    assert.match(firstKey as string, /^nxs_pc_[A-Za-z0-9_-]{43}$/);
    assert.equal((firstKey as string).includes('RAW_THREAD_IDENTIFIER_12345'), false);
    assert.equal(Buffer.byteLength(firstKey as string, 'utf8') <= 64, true);
    assert.deepEqual(firstUsage, { inputTokens: 120, outputTokens: 4, cachedInputTokens: 80 });

    await streamOnce(requestFor('official-chat'));
    const repeatedKey = capturedBodies.at(-1)?.body.prompt_cache_key;
    assert.equal(repeatedKey, firstKey, 'same provider/model/affinity/lineage must derive a stable cache key');

    const childAffinityRequest = requestFor('official-chat');
    childAffinityRequest.cache = {
      ...childAffinityRequest.cache!,
      scopeKey: 'nexus:subagent:other-run:other-delegation',
    };
    await streamOnce(childAffinityRequest);
    const childAffinityKey = capturedBodies.at(-1)?.body.prompt_cache_key;
    assert.equal(
      childAffinityKey,
      firstKey,
      'different Root/Child scopes sharing one affinity and lineage must derive the same provider routing key',
    );

    await streamOnce(requestFor('official-chat', 'gpt-5.6-sol', 'stable-prefix-v2'));
    const changedLineageKey = capturedBodies.at(-1)?.body.prompt_cache_key;
    assert.notEqual(
      changedLineageKey,
      firstKey,
      'stable prefix/tool lineage change must change the provider cache key',
    );

    await streamOnce(requestFor('official-chat', 'gpt-5.6-terra'));
    const changedModelKey = capturedBodies.at(-1)?.body.prompt_cache_key;
    assert.notEqual(changedModelKey, firstKey, 'model identity must participate in cache key derivation');

    const responsesUsage = await streamOnce(requestFor('official-responses'));
    const responsesBody = capturedBodies.at(-1)?.body ?? {};
    assert.equal(typeof responsesBody.prompt_cache_key, 'string');
    assert.match(responsesBody.prompt_cache_key as string, /^nxs_pc_[A-Za-z0-9_-]{43}$/);
    assert.notEqual(
      responsesBody.prompt_cache_key,
      firstKey,
      'provider identity must participate in cache key derivation while both protocols consume the same hint contract',
    );
    assert.deepEqual(responsesUsage, { inputTokens: 140, outputTokens: 5, cachedInputTokens: 96 });

    const customReasoningRequest = requestFor('custom-responses', 'proxy-reasoner');
    customReasoningRequest.reasoningEffort = 'high';
    customReasoningRequest.capabilitySnapshot = {
      ...capabilitySnapshot,
      reasoningEfforts: ['low', 'high'],
      defaultReasoningEffort: 'high',
    };
    await streamOnce(customReasoningRequest);
    const customReasoningBody = capturedBodies.at(-1)?.body ?? {};
    assert.equal(
      (customReasoningBody.reasoning as { effort?: unknown } | undefined)?.effort,
      'high',
      'Responses transport must preserve frozen reasoning effort for custom model IDs declared reasoning-capable by Nexus',
    );

    await streamOnce(requestFor('third-party'));
    const compatibleBody = capturedBodies.at(-1)?.body ?? {};
    assert.equal(
      Object.prototype.hasOwnProperty.call(compatibleBody, 'prompt_cache_key'),
      false,
      'third-party OpenAI-compatible endpoints must not receive OpenAI vendor cache fields by default',
    );

    const unsupportedRequest = requestFor('official-chat');
    unsupportedRequest.capabilitySnapshot = {
      ...capabilitySnapshot,
      supportsPromptCacheKey: false,
    } as typeof capabilitySnapshot;
    await streamOnce(unsupportedRequest);
    const unsupportedBody = capturedBodies.at(-1)?.body ?? {};
    assert.equal(
      Object.prototype.hasOwnProperty.call(unsupportedBody, 'prompt_cache_key'),
      false,
      'model capability gate must suppress prompt_cache_key when support is not frozen',
    );

    return [
      { name: 'official_cache_key_bytes', value: Buffer.byteLength(firstKey as string, 'utf8'), unit: 'bytes' },
      { name: 'chat_cached_input_tokens', value: firstUsage?.cachedInputTokens ?? 0, unit: 'tokens' },
      { name: 'responses_cached_input_tokens', value: responsesUsage?.cachedInputTokens ?? 0, unit: 'tokens' },
      {
        name: 'custom_responses_reasoning_effort',
        value: (customReasoningBody.reasoning as { effort?: unknown } | undefined)?.effort === 'high' ? 1 : 0,
        unit: 'cases',
      },
      { name: 'third_party_cache_fields', value: 0, unit: 'fields' },
      { name: 'unsupported_model_cache_fields', value: 0, unit: 'fields' },
      { name: 'stable_cache_key_reuses', value: repeatedKey === firstKey ? 1 : 0, unit: 'cases' },
      { name: 'root_child_affinity_reuses', value: childAffinityKey === firstKey ? 1 : 0, unit: 'cases' },
      { name: 'lineage_cache_key_changes', value: changedLineageKey !== firstKey ? 1 : 0, unit: 'cases' },
      { name: 'model_cache_key_changes', value: changedModelKey !== firstKey ? 1 : 0, unit: 'cases' },
    ];
  } finally {
    globalThis.fetch = originalFetch;
  }
};
