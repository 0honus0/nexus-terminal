import assert from 'node:assert/strict';
import { OpenAiProviderAdapter } from '../../packages/backend/src/infrastructure/agent/providers/openai-provider.adapter';

interface FakeReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
}

const responseWithReader = (reader: FakeReader, headers: Headers = new Headers()): Response =>
  ({
    status: 200,
    ok: true,
    headers,
    body: { getReader: () => reader },
  }) as unknown as Response;

const main = async (): Promise<void> => {
  const originalFetch = globalThis.fetch;
  const adapter = new OpenAiProviderAdapter({} as never, {} as never);
  try {
    let reads = 0;
    let cancelled = false;
    const oversizedReader: FakeReader = {
      read: async () => {
        reads += 1;
        if (reads <= 4) return { done: false, value: new Uint8Array(256 * 1024) };
        if (reads === 5) return { done: false, value: Uint8Array.of(0x7b) };
        return { done: true };
      },
      cancel: async () => {
        cancelled = true;
      },
    };
    globalThis.fetch = async () => responseWithReader(oversizedReader);

    await assert.rejects(
      adapter.discoverEndpointModels('https://provider.example/v1', undefined, new AbortController().signal),
      /PROVIDER_MODELS_RESPONSE_TOO_LARGE/,
    );
    assert.equal(reads, 5, 'reader must stop on the first chunk that crosses the 1MB boundary');
    assert.equal(cancelled, true, 'oversized provider body must be cancelled immediately');

    const payload = Buffer.from(
      JSON.stringify({ data: [{ id: 'model-a', owned_by: 'fixture-owner', created: 123 }] }),
      'utf8',
    );
    let smallReads = 0;
    const validReader: FakeReader = {
      read: async () => {
        smallReads += 1;
        return smallReads === 1 ? { done: false, value: payload } : { done: true };
      },
      cancel: async () => undefined,
    };
    globalThis.fetch = async () => responseWithReader(validReader, new Headers({ 'content-type': 'application/json' }));

    const discovered = await adapter.discoverEndpointModels(
      'https://provider.example/v1',
      undefined,
      new AbortController().signal,
    );
    assert.deepEqual(discovered, [{ id: 'model-a', ownedBy: 'fixture-owner', createdAt: 123 }]);

    process.stdout.write('provider model discovery bounded response regression: PASS\n');
  } finally {
    globalThis.fetch = originalFetch;
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
