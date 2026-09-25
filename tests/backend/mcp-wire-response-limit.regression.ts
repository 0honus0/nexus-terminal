import assert from 'node:assert/strict';
import {
  MCP_SSE_EVENT_LIMIT_BYTES,
  MCP_WIRE_RESPONSE_LIMIT_BYTES,
  boundMcpResponse,
} from '../../packages/backend/src/infrastructure/agent/integrations/safe-mcp-fetch';

const streamOf = (chunks: Uint8Array[], onPull?: () => void): ReadableStream<Uint8Array> => {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      onPull?.();
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index++]!);
    },
  });
};

const main = async (): Promise<void> => {
  assert.equal(MCP_WIRE_RESPONSE_LIMIT_BYTES, 10 * 1024 * 1024 + 256 * 1024);
  assert.equal(MCP_SSE_EVENT_LIMIT_BYTES, 10 * 1024 * 1024 + 64 * 1024);

  const declared = new Response(streamOf([new Uint8Array([1])]), {
    headers: {
      'content-type': 'application/json',
      'content-length': String(MCP_WIRE_RESPONSE_LIMIT_BYTES + 1),
    },
  });
  await assert.rejects(() => boundMcpResponse(declared), /MCP_RESPONSE_TOO_LARGE/);

  const oneMiB = new Uint8Array(1024 * 1024);
  let jsonPulls = 0;
  const json = await boundMcpResponse(
    new Response(
      streamOf(
        Array.from({ length: 12 }, () => oneMiB),
        () => (jsonPulls += 1),
      ),
      {
        headers: { 'content-type': 'application/json' },
      },
    ),
  );
  await assert.rejects(() => json.arrayBuffer(), /MCP_RESPONSE_TOO_LARGE/);
  assert(
    jsonPulls < 13,
    'JSON transport must stop pulling after crossing the wire limit instead of materializing the full response',
  );

  let ssePulls = 0;
  const oversizedEvent = await boundMcpResponse(
    new Response(
      streamOf(
        Array.from({ length: 12 }, () => oneMiB),
        () => (ssePulls += 1),
      ),
      {
        headers: { 'content-type': 'text/event-stream' },
      },
    ),
  );
  await assert.rejects(() => oversizedEvent.arrayBuffer(), /MCP_SSE_EVENT_TOO_LARGE/);
  assert(
    ssePulls < 13,
    'SSE transport must stop pulling before an oversized event is fully materialized by the SDK parser',
  );

  const smallEvent = new TextEncoder().encode(`data: ${'x'.repeat(512 * 1024)}\n\n`);
  const longLivedSse = await boundMcpResponse(
    new Response(streamOf(Array.from({ length: 24 }, () => smallEvent)), {
      headers: { 'content-type': 'text/event-stream' },
    }),
  );
  const longLivedBytes = (await longLivedSse.arrayBuffer()).byteLength;
  assert(
    longLivedBytes > MCP_WIRE_RESPONSE_LIMIT_BYTES,
    'many bounded SSE events may exceed the JSON total-body limit',
  );

  process.stdout.write('MCP wire response limit regression: PASS\n');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
