import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as fetchPinned } from 'undici';
import { FetchFailure } from '../bounded-fetch.js';
import { SafeHttpRequestRefusal } from '../safe-http-stream.js';
import type {
	SafeHttpConnection,
	SafeHttpConnectionOptions,
	SafeHttpHeader,
	SafeHttpRequest,
	SafeHttpResponse,
} from '../safe-http-stream.js';

const forbiddenHeaders = new Set([
	'authorization',
	'cookie',
	'cookie2',
	'host',
	'connection',
	'content-length',
	'expect',
	'keep-alive',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
	'forwarded',
]);

function protocolHeaders(input: readonly SafeHttpHeader[]): Headers {
	const headers = new Headers();
	for (const { name, value } of input) {
		const lower = name.toLowerCase();
		if (
			!name ||
			!/^[!#$%&'*+.^_`|~0-9a-z-]+$/iu.test(name) ||
			forbiddenHeaders.has(lower) ||
			lower.startsWith('proxy-') ||
			lower.startsWith('sec-') ||
			lower.startsWith('x-forwarded-') ||
			/[\u0000-\u001f\u007f]/u.test(value)
		) {
			throw new FetchFailure('unavailable');
		}
		headers.append(name, value);
	}
	return headers;
}

/** A fixed-origin, pinned-DNS connection. No protocol SDK or application identity belongs here. */
export class NativeSafeHttpConnection implements SafeHttpConnection {
	private readonly stop = new AbortController();
	private readonly signal: AbortSignal;
	private readonly url: URL;
	private dispatcherPromise: Promise<Agent> | null = null;
	private readonly requests = new Set<Promise<unknown>>();
	private readonly responses = new Set<SafeHttpResponse>();
	private closePromise: Promise<void> | null = null;
	private readonly abort: () => void;

	constructor(private readonly options: SafeHttpConnectionOptions) {
		this.url = new URL(options.url);
		if (this.url.username || this.url.password || !['http:', 'https:'].includes(this.url.protocol)) {
			throw new FetchFailure('unavailable');
		}
		if (!Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes < 1) {
			throw new FetchFailure('limit_exceeded');
		}
		this.signal = AbortSignal.any([options.signal, this.stop.signal]);
		this.abort = () => {
			void this.close().catch(() => undefined);
		};
		options.signal.addEventListener('abort', this.abort, { once: true });
		if (options.signal.aborted) {
			this.abort();
		}
	}

	request(input: SafeHttpRequest): Promise<SafeHttpResponse> {
		if (this.closePromise || this.signal.aborted) {
			return Promise.reject(new SafeHttpRequestRefusal());
		}
		const pending = Promise.resolve().then(async () => {
			let headers: Headers;
			let dispatcher: Agent;
			try {
				headers = protocolHeaders(input.headers);
				// Owner-held configuration always wins; consumer headers cannot reveal or replace secrets.
				for (const { name, value } of this.options.headers) {
					headers.set(name, value);
				}
				dispatcher = await (this.dispatcherPromise ??= this.createDispatcher());
				this.signal.throwIfAborted();
			} catch (cause) {
				throw new SafeHttpRequestRefusal({ cause });
			}
			const response = await fetchPinned(this.url, {
				method: input.method,
				headers: Object.fromEntries(headers.entries()),
				body: input.bodyUtf8 ?? undefined,
				redirect: 'error',
				signal: this.signal,
				dispatcher,
			});
			const body = new NativeSafeHttpResponse(response, this.options.maxResponseBytes, this.signal, () => {
				this.responses.delete(body);
			});
			this.responses.add(body);
			if (this.closePromise || this.signal.aborted) {
				await body.close();
				throw new FetchFailure('unavailable');
			}
			return body;
		});
		this.requests.add(pending);
		void pending.then(
			() => this.requests.delete(pending),
			() => this.requests.delete(pending),
		);
		return pending;
	}

	private async createDispatcher(): Promise<Agent> {
		const hostname = this.url.hostname.replace(/^\[|\]$/gu, '');
		const addresses = isIP(hostname)
			? [{ address: hostname, family: isIP(hostname) }]
			: await lookup(hostname, { all: true, verbatim: true });
		this.signal.throwIfAborted();
		const authority =
			this.url.hostname.toLowerCase() + ':' + (this.url.port || (this.url.protocol === 'https:' ? '443' : '80'));
		const exception = this.options.privateAuthorities.includes(authority);
		if (!addresses.length) {
			throw new FetchFailure('unavailable');
		}
		for (const { address } of addresses) {
			const parsed = ipaddr.process(address);
			const range = parsed.range();
			const privateRange = ['private', 'loopback', 'uniqueLocal', 'carrierGradeNat'].includes(range);
			if (
				(range !== 'unicast' && !privateRange) ||
				['169.254.169.254', '100.100.100.200', 'fd00:ec2::254'].includes(parsed.toString()) ||
				(privateRange && !exception) ||
				(this.url.protocol === 'http:' &&
					!(exception && range === 'loopback' && process.env.NODE_ENV !== 'production'))
			) {
				throw new FetchFailure('unavailable');
			}
		}
		const selected = addresses[0];
		return new Agent({
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
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.closePromise = Promise.resolve().then(async () => {
				const failures: unknown[] = [];
				// Destroying the dispatcher interrupts headers and body reads as well as queued fetches.
				if (this.dispatcherPromise) {
					let dispatcher: Agent | null = null;
					try {
						dispatcher = await this.dispatcherPromise;
					} catch {
						/* opening already failed */
					}
					if (dispatcher) {
						try {
							await dispatcher.destroy();
						} catch (error) {
							failures.push(error);
						}
					}
				}
				await Promise.allSettled([...this.requests]);
				const settled = await Promise.allSettled([...this.responses].map((response) => response.close()));
				for (const result of settled) {
					if (result.status === 'rejected') {
						failures.push(result.reason);
					}
				}
				this.options.signal.removeEventListener('abort', this.abort);
				if (failures.length) {
					throw new FetchFailure('cleanup_failed', { cause: new AggregateError(failures) });
				}
			});
			this.stop.abort();
		}
		return this.closePromise;
	}
}

class NativeSafeHttpResponse implements SafeHttpResponse {
	readonly status: number;
	readonly statusText: string;
	readonly headers: SafeHttpHeader[];
	readonly hasBody: boolean;
	private readonly reader: ReadableStreamDefaultReader<Uint8Array> | null;
	private pending: Promise<{ bytes: Uint8Array; eof: boolean }> | null = null;
	private remainder: Uint8Array = new Uint8Array(0);
	private total = 0;
	private ended = false;
	private closePromise: Promise<void> | null = null;

	constructor(
		response: Awaited<ReturnType<typeof fetchPinned>>,
		private readonly maxBytes: number,
		private readonly signal: AbortSignal,
		private readonly released: () => void,
	) {
		this.status = response.status;
		this.statusText = response.statusText;
		this.headers = [...response.headers.entries()]
			.filter(
				([name]) =>
					!['set-cookie', 'set-cookie2', 'authorization', 'proxy-authorization'].includes(name.toLowerCase()),
			)
			.map(([name, value]) => ({ name, value }));
		this.hasBody = response.body !== null;
		this.reader = response.body?.getReader() ?? null;
	}

	read(maxBytes: number): Promise<{ bytes: Uint8Array; eof: boolean }> {
		if (this.pending || this.closePromise || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
			return Promise.reject(new FetchFailure('unavailable'));
		}
		const pending = Promise.resolve()
			.then(async () => {
				if (this.ended || !this.reader) {
					return { bytes: new Uint8Array(0), eof: true };
				}
				while (!this.remainder.byteLength) {
					const value = await this.reader.read();
					if (value.done) {
						this.ended = true;
						return { bytes: new Uint8Array(0), eof: true };
					}
					this.total += value.value.byteLength;
					if (this.total > this.maxBytes) {
						await this.reader.cancel();
						throw new FetchFailure('limit_exceeded');
					}
					this.remainder = value.value;
				}
				const bytes = this.remainder.slice(0, maxBytes);
				this.remainder = this.remainder.subarray(bytes.byteLength);
				return { bytes, eof: false };
			})
			.catch((error: unknown) => {
				if (this.closePromise || this.signal.aborted) {
					return { bytes: new Uint8Array(0), eof: true };
				}
				throw error;
			});
		this.pending = pending;
		void pending.then(
			() => {
				this.pending = null;
			},
			() => {
				this.pending = null;
			},
		);
		return pending;
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.closePromise = Promise.resolve().then(async () => {
				try {
					await this.reader?.cancel();
				} catch (error) {
					if (!this.signal.aborted) {
						throw error;
					}
				} finally {
					await Promise.allSettled(this.pending ? [this.pending] : []);
					this.reader?.releaseLock();
					this.remainder = new Uint8Array(0);
					this.ended = true;
				}
				this.released();
			});
		}
		return this.closePromise;
	}
}
