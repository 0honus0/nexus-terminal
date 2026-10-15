import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as fetchPinned } from 'undici';
import type { FetchLike } from '@modelcontextprotocol/client';
import { McpFailure } from '../mcp-client.js';

/** One connection scope; DNS is pinned and every response stream remains owned until close. */
export class McpFetch {
	private activeDispatcher: Agent | null = null;
	private dispatcherPromise: Promise<Agent> | null = null;
	private closed = false;
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly origin: string,
		private readonly privateAuthorities: readonly string[],
		private readonly signal: AbortSignal,
	) {}

	readonly fetch: FetchLike = async (input, init) => {
		if (this.closed) {
			throw new McpFailure('unavailable');
		}
		const url = input instanceof URL ? input : new URL(input);
		if (url.origin !== this.origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) {
			throw new McpFailure('unavailable');
		}
		const signal = AbortSignal.any([this.signal, ...(init?.signal ? [init.signal] : [])]);
		const dispatcher = await this.dispatcher(url);
		signal.throwIfAborted();
		try {
			if (init?.body !== undefined && init.body !== null && typeof init.body !== 'string') {
				throw new McpFailure('invalid_response');
			}
			const headers = Object.fromEntries(new Headers(init?.headers).entries());
			const response = await fetchPinned(url, {
				method: init?.method,
				headers,
				body: init?.body ?? undefined,
				signal,
				redirect: 'error',
				dispatcher,
			});
			// The SDK fetch contract and Undici share web Response semantics at this technical boundary.
			const native = response as unknown as Response;
			if (!native.body) {
				return native;
			}
			let total = 0;
			const bounded = native.body.pipeThrough(
				new TransformStream<Uint8Array, Uint8Array>({
					transform(chunk, controller) {
						total += chunk.byteLength;
						if (total > 12 * 1024 * 1024) {
							throw new McpFailure('limit_exceeded');
						}
						controller.enqueue(chunk);
					},
				}),
			);
			return new Response(bounded, {
				status: native.status,
				statusText: native.statusText,
				headers: native.headers,
			});
		} catch (cause) {
			throw new McpFailure('unavailable', { cause });
		}
	};

	private dispatcher(url: URL): Promise<Agent> {
		if (this.dispatcherPromise === null) {
			this.dispatcherPromise = this.createDispatcher(url);
		}
		return this.dispatcherPromise;
	}

	private async createDispatcher(url: URL): Promise<Agent> {
		const hostname = url.hostname.replace(/^\[|\]$/gu, '');
		const addresses = isIP(hostname)
			? [{ address: hostname, family: isIP(hostname) }]
			: await lookup(hostname, { all: true, verbatim: true });
		this.signal.throwIfAborted();
		if (this.closed) {
			throw new McpFailure('unavailable');
		}
		const authority = url.hostname.toLowerCase() + ':' + (url.port || (url.protocol === 'https:' ? '443' : '80'));
		const exception = this.privateAuthorities.includes(authority);
		if (!addresses.length) {
			throw new McpFailure('unavailable');
		}
		for (const { address } of addresses) {
			const parsed = ipaddr.process(address),
				range = parsed.range();
			const privateRange = ['private', 'loopback', 'uniqueLocal', 'carrierGradeNat'].includes(range);
			if (
				(range !== 'unicast' && !privateRange) ||
				['169.254.169.254', '100.100.100.200', 'fd00:ec2::254'].includes(parsed.toString()) ||
				(privateRange && !exception)
			) {
				throw new McpFailure('unavailable');
			}
			if (
				url.protocol === 'http:' &&
				!(exception && range === 'loopback' && process.env.NODE_ENV !== 'production')
			) {
				throw new McpFailure('unavailable');
			}
		}
		const selected = addresses[0];
		if (!selected) {
			throw new McpFailure('unavailable');
		}
		const dispatcher = new Agent({
			connections: 4,
			pipelining: 1,
			connect: {
				lookup: (_hostname, options, callback) => {
					if (typeof options === 'object' && options.all) {
						callback(null, [selected]);
					} else {
						callback(null, selected.address, selected.family);
					}
				},
			},
		});
		this.activeDispatcher = dispatcher;
		return dispatcher;
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.closed = true;
		this.closePromise = Promise.resolve().then(async () => {
			if (this.dispatcherPromise) {
				await Promise.allSettled([this.dispatcherPromise]);
			}
			try {
				await this.activeDispatcher?.destroy();
			} catch (cause) {
				throw new McpFailure('cleanup_failed', {
					cause,
				});
			}
			this.activeDispatcher = null;
		});
		return this.closePromise;
	}
}
