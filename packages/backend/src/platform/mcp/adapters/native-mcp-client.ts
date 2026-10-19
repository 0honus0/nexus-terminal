import { Client, StreamableHTTPClientTransport, isInputRequiredResult } from '@modelcontextprotocol/client';
import type { McpClient, McpEndpoint, McpCatalog, McpRequest, McpReply } from '../mcp-client.js';
import { McpFailure } from '../mcp-client.js';
import { McpFetch } from './mcp-fetch.js';

function encoded(input: unknown, maxBytes = 8 * 1024 * 1024): string {
	const result = JSON.stringify(input);
	if (result === undefined || Buffer.byteLength(result, 'utf8') > maxBytes) {
		throw new McpFailure('limit_exceeded');
	}
	return result;
}

function catalogText(value: string, maxBytes: number): string {
	if (!value.trim()) {
		throw new McpFailure('invalid_response');
	}
	if (Buffer.byteLength(value, 'utf8') > maxBytes) {
		throw new McpFailure('limit_exceeded');
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function objectJson(input: string): Record<string, unknown> {
	const value: unknown = JSON.parse(input);
	if (!isRecord(value)) {
		throw new McpFailure('invalid_response');
	}
	return value;
}

interface McpConnection {
	generation: number;
	client: Client;
	fetcher: McpFetch;
	stop: AbortController;
	closing: Promise<void> | null;
}

export class NativeMcpClient implements McpClient {
	private readonly sessions = new Map<string, McpConnection>();
	private readonly opening = new Map<string, { stop: AbortController; promise: Promise<McpConnection> }>();
	private readonly stop = new AbortController();
	private closePromise: Promise<void> | null = null;

	private async connected<T>(
		endpoint: McpEndpoint,
		signal: AbortSignal,
		work: (client: Client, signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		const combined = AbortSignal.any([signal, this.stop.signal]);
		const active = await this.connection(endpoint, combined);
		combined.throwIfAborted();
		try {
			if (active.closing) {
				throw new McpFailure('unavailable');
			}
			return await work(active.client, AbortSignal.any([combined, active.stop.signal]));
		} catch (error) {
			throw error instanceof McpFailure ? error : new McpFailure('unavailable', { cause: error });
		}
	}

	private async connection(endpoint: McpEndpoint, signal: AbortSignal): Promise<McpConnection> {
		for (;;) {
			if (this.closePromise) {
				throw new McpFailure('unavailable');
			}
			signal.throwIfAborted();
			const active = this.sessions.get(endpoint.key);
			if (active) {
				if (active.generation === endpoint.generation) {
					return active;
				}
				await this.close(endpoint.key);
				continue;
			}
			const pending = this.opening.get(endpoint.key);
			if (pending) {
				await pending.promise;
				continue;
			}
			if (this.sessions.size + this.opening.size >= 128) {
				throw new McpFailure('limit_exceeded');
			}
			const stop = new AbortController();
			const promise = Promise.resolve().then(() =>
				this.createConnection(
					endpoint,
					AbortSignal.any([this.stop.signal, stop.signal, AbortSignal.timeout(15000)]),
				),
			);
			this.opening.set(endpoint.key, { stop, promise });
			void promise.then(
				() => this.opening.delete(endpoint.key),
				(error) => {
					if (!(error instanceof McpFailure) || error.kind !== 'cleanup_failed') {
						this.opening.delete(endpoint.key);
					}
				},
			);
			return promise;
		}
	}

	private async createConnection(endpoint: McpEndpoint, signal: AbortSignal): Promise<McpConnection> {
		const stop = new AbortController();
		const fetcher = new McpFetch(new URL(endpoint.url).origin, endpoint.privateAuthorities, stop.signal);
		const client = new Client(
			{ name: endpoint.client.name, version: endpoint.client.version },
			{
				enforceStrictCapabilities: true,
				listMaxPages: 16,
				versionNegotiation: {
					mode: { pin: endpoint.protocolVersion },
					probe: { timeoutMs: 10000, maxRetries: 0 },
				},
				inputRequired: { autoFulfill: false, maxRounds: 0 },
			},
		);
		const headers: Record<string, string> = { Accept: 'application/json, text/event-stream' };
		if (endpoint.credential !== null) {
			headers.Authorization = 'Bearer ' + endpoint.credential;
		}
		const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
			requestInit: { headers },
			fetch: fetcher.fetch,
			onInsufficientScope: 'throw',
			maxStepUpRetries: 0,
			reconnectionOptions: {
				maxReconnectionDelay: 1000,
				initialReconnectionDelay: 1000,
				reconnectionDelayGrowFactor: 1,
				maxRetries: 0,
			},
		});
		try {
			await client.connect(transport, { signal, timeout: 15000 });
			if (client.getNegotiatedProtocolVersion() !== endpoint.protocolVersion) {
				throw new McpFailure('invalid_response');
			}
			signal.throwIfAborted();
		} catch (error) {
			stop.abort();
			const released = await Promise.allSettled([
				Promise.resolve().then(() => client.close()),
				Promise.resolve().then(() => fetcher.close()),
			]);
			const failures = released.flatMap((value) => (value.status === 'rejected' ? [value.reason] : []));
			if (failures.length) {
				throw new McpFailure('cleanup_failed', {
					cause: new AggregateError([error, ...failures], 'MCP connect and release failed'),
				});
			}
			throw error instanceof McpFailure ? error : new McpFailure('unavailable', { cause: error });
		}
		const active: McpConnection = { generation: endpoint.generation, client, fetcher, stop, closing: null };
		this.sessions.set(endpoint.key, active);
		return active;
	}

	close(key: string): Promise<void> {
		const pending = this.opening.get(key);
		if (pending) {
			pending.stop.abort();
			return pending.promise.then(
				(active) => this.release(key, active),
				(error: unknown) => {
					if (!(error instanceof McpFailure) || error.kind === 'cleanup_failed') {
						throw error;
					}
				},
			);
		}
		const active = this.sessions.get(key);
		if (!active) {
			return Promise.resolve();
		}
		return this.release(key, active);
	}

	private release(key: string, active: McpConnection): Promise<void> {
		if (active.closing) {
			return active.closing;
		}
		active.closing = Promise.resolve().then(async () => {
			const failures: unknown[] = [];
			try {
				await active.client.close();
			} catch (error) {
				failures.push(error);
			}
			active.stop.abort();
			try {
				await active.fetcher.close();
			} catch (error) {
				failures.push(error);
			}
			if (failures.length) {
				throw new McpFailure('cleanup_failed', { cause: new AggregateError(failures, 'MCP release failed') });
			}
			if (this.sessions.get(key) === active) {
				this.sessions.delete(key);
			}
		});
		return active.closing;
	}

	closeAll(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.closePromise = Promise.resolve().then(async () => {
			const started = await Promise.allSettled([...this.opening.values()].map((item) => item.promise));
			const closed = await Promise.allSettled([...this.sessions.keys()].map((key) => this.close(key)));
			const failures = [...started, ...closed].flatMap((item) =>
				item.status === 'rejected' &&
				(!(item.reason instanceof McpFailure) || item.reason.kind === 'cleanup_failed')
					? [item.reason]
					: [],
			);
			if (failures.length) {
				throw new McpFailure('cleanup_failed', {
					cause: new AggregateError(failures, 'MCP owner release failed'),
				});
			}
		});
		this.stop.abort();
		return this.closePromise;
	}

	discover(endpoint: McpEndpoint, signal: AbortSignal): Promise<McpCatalog> {
		return this.connected(endpoint, signal, async (client, signal) => {
			const capabilities = client.getServerCapabilities();
			const [tools, resources, prompts] = await Promise.all([
				capabilities?.tools
					? client.listTools(undefined, { signal, timeout: 60000, cacheMode: 'refresh' })
					: Promise.resolve({ tools: [] }),
				capabilities?.resources
					? client.listResources(undefined, { signal, timeout: 60000, cacheMode: 'refresh' })
					: Promise.resolve({ resources: [] }),
				capabilities?.prompts
					? client.listPrompts(undefined, { signal, timeout: 60000, cacheMode: 'refresh' })
					: Promise.resolve({ prompts: [] }),
			]);
			if (tools.tools.length > 256 || resources.resources.length > 2048 || prompts.prompts.length > 512) {
				throw new McpFailure('limit_exceeded');
			}
			if (
				new Set(tools.tools.map((item) => item.name)).size !== tools.tools.length ||
				new Set(resources.resources.map((item) => item.uri)).size !== resources.resources.length ||
				new Set(prompts.prompts.map((item) => item.name)).size !== prompts.prompts.length
			) {
				throw new McpFailure('invalid_response');
			}
			const result = {
				serverName: catalogText(client.getServerVersion()?.name ?? '', 1024),
				serverVersion: catalogText(client.getServerVersion()?.version ?? '', 1024),
				protocolVersion: catalogText(client.getNegotiatedProtocolVersion() ?? '', 64),
				tools: tools.tools.map((item) => ({
					name: catalogText(item.name, 1024),
					description: catalogText(item.description?.trim() ? item.description : item.name, 32768),
					inputSchemaJson: encoded(item.inputSchema, 1024 * 1024),
				})),
				resources: resources.resources.map((item) => ({
					uri: catalogText(item.uri, 4096),
					name: catalogText(item.name, 1024),
				})),
				prompts: prompts.prompts.map((item) => ({
					name: catalogText(item.name, 1024),
					description: catalogText(item.description?.trim() ? item.description : item.name, 32768),
				})),
			};
			encoded(result);
			return result;
		});
	}

	invoke(endpoint: McpEndpoint, request: McpRequest, signal: AbortSignal): Promise<McpReply> {
		return this.connected(endpoint, signal, async (client, signal) => {
			const args = objectJson(request.argumentsJson);
			const resume =
				request.resume === null
					? {}
					: {
							requestState: request.resume.requestState ?? undefined,
							inputResponses: objectJson(request.resume.inputResponsesJson),
						};
			const options = { signal, timeout: 60000, allowInputRequired: true as const };
			let result: unknown;
			// SDK operation types omit its negotiated input_required extension; assert only at this third-party boundary.
			if (request.kind === 'tool') {
				result = await client.callTool({ name: request.name, arguments: args, ...resume } as never, options);
			} else if (request.kind === 'resource') {
				result = await client.readResource({ uri: request.name, ...resume } as never, options);
			} else {
				const texts: Record<string, string> = {};
				for (const [key, value] of Object.entries(args)) {
					if (typeof value !== 'string') {
						throw new McpFailure('invalid_response');
					}
					texts[key] = value;
				}
				result = await client.getPrompt({ name: request.name, arguments: texts, ...resume } as never, options);
			}
			if (isInputRequiredResult(result)) {
				return {
					kind: 'input_required',
					requestState: result.requestState ?? null,
					inputRequestsJson: encoded(result.inputRequests),
				};
			}
			return { kind: 'complete', resultJson: encoded(result) };
		});
	}
}
