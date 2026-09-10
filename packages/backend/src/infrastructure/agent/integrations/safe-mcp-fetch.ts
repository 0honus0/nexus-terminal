import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type { FetchLike } from '@modelcontextprotocol/client';
import type { OutboundPolicyPort } from '../../../modules/agent/ai/outbound-policy.port';

const MAX_DISPATCHERS = 128;

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
      return response as unknown as Awaited<ReturnType<FetchLike>>;
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
