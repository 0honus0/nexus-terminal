import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type { FetchLike } from '@modelcontextprotocol/client';
import type { OutboundPolicyPort } from '../../../modules/agent/ai/outbound-policy.port';

const MAX_DISPATCHERS = 128;
export const MCP_WIRE_RESPONSE_LIMIT_BYTES = 10 * 1024 * 1024 + 256 * 1024;
export const MCP_SSE_EVENT_LIMIT_BYTES = 10 * 1024 * 1024 + 64 * 1024;

const boundedByteStream = (
  body: ReadableStream<Uint8Array>,
  limit: number,
  errorCode: string,
): ReadableStream<Uint8Array> => {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > limit) throw new Error(errorCode);
        controller.enqueue(chunk);
      },
    }),
  );
};

const boundedSseStream = (body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> => {
  let eventBytes = 0;
  const tail: number[] = [];
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        for (const byte of chunk) {
          eventBytes += 1;
          tail.push(byte);
          if (tail.length > 4) tail.shift();
          const lfBoundary = tail.length >= 2 && tail[tail.length - 2] === 0x0a && tail[tail.length - 1] === 0x0a;
          const crlfBoundary =
            tail.length === 4 && tail[0] === 0x0d && tail[1] === 0x0a && tail[2] === 0x0d && tail[3] === 0x0a;
          if (eventBytes > MCP_SSE_EVENT_LIMIT_BYTES) throw new Error('MCP_SSE_EVENT_TOO_LARGE');
          if (lfBoundary || crlfBoundary) {
            eventBytes = 0;
            tail.length = 0;
          }
        }
        controller.enqueue(chunk);
      },
    }),
  );
};

export const boundMcpResponse = async (response: Response): Promise<Response> => {
  if (!response.body) return response;
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const isSse = contentType.includes('text/event-stream');
  if (!isSse) {
    const declared = response.headers.get('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > MCP_WIRE_RESPONSE_LIMIT_BYTES) {
      await response.body.cancel().catch(() => undefined);
      throw new Error('MCP_RESPONSE_TOO_LARGE');
    }
  }
  const body = isSse
    ? boundedSseStream(response.body)
    : boundedByteStream(response.body, MCP_WIRE_RESPONSE_LIMIT_BYTES, 'MCP_RESPONSE_TOO_LARGE');
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

export class SafeMcpFetch {
  private readonly dispatchers = new Set<Agent>();
  private readonly configuredOrigin: string;

  constructor(
    endpoint: string,
    private readonly privateHostExceptions: readonly string[],
    private readonly outboundPolicy: OutboundPolicyPort,
  ) {
    this.configuredOrigin = new URL(endpoint).origin;
  }

  readonly fetch: FetchLike = async (input, init) => {
    const requestUrl = input instanceof URL ? input : new URL(input);
    if (requestUrl.origin !== this.configuredOrigin) throw new Error('MCP_CROSS_ORIGIN_DENIED');
    if (this.dispatchers.size >= MAX_DISPATCHERS) throw new Error('MCP_CONNECTION_LIMIT');
    const endpoint = await this.outboundPolicy.resolve(requestUrl.toString(), this.privateHostExceptions);
    const address = endpoint.addresses[0];
    if (!address) throw new Error('MCP_DNS_RESOLUTION_FAILED');
    const family = net.isIP(address);
    if (!family) throw new Error('MCP_DNS_RESOLUTION_FAILED');
    const dispatcher = new Agent({
      connections: 1,
      pipelining: 1,
      connect: {
        servername: net.isIP(endpoint.hostname) === 0 ? endpoint.tlsServerName : undefined,
        lookup: (_hostname, options, callback) => {
          if (typeof options === 'object' && options.all) {
            callback(null, [{ address, family }] as never);
          } else {
            callback(null, address, family);
          }
        },
      },
    });
    this.dispatchers.add(dispatcher);
    try {
      const response = await undiciFetch(requestUrl, {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher,
        redirect: 'manual',
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error('MCP_REDIRECT_DENIED');
      }
      // close() is graceful: it waits for this response body to finish without
      // accepting new connections. Do not await it here or streaming responses
      // would deadlock before the caller can consume their body.
      void dispatcher.close().finally(() => this.dispatchers.delete(dispatcher));
      return (await boundMcpResponse(response as unknown as Response)) as unknown as Awaited<ReturnType<FetchLike>>;
    } catch (error) {
      await dispatcher.close().catch(() => undefined);
      this.dispatchers.delete(dispatcher);
      throw error;
    }
  };

  async close(): Promise<void> {
    const active = [...this.dispatchers];
    this.dispatchers.clear();
    await Promise.all(active.map((dispatcher) => dispatcher.close().catch(() => undefined)));
  }
}
