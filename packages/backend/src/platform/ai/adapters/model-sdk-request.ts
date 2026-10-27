import OpenAI from 'openai';
import { Agent, fetch as undiciFetch } from 'undici';
import type {
	ReadableStream as NodeReadableStream,
	ReadableStreamDefaultReader as NodeReadableStreamDefaultReader,
} from 'node:stream/web';
import { ModelNetworkFailure, MODEL_STREAM_MAX_BYTES } from '../model-port.js';
import type { Logger } from '../../logging/logger.js';
import { logDiagnostic } from '../../logging/diagnostic-log.js';

function modelCleanupFailure(failures: unknown[], primary?: unknown): ModelNetworkFailure {
	const reasons = primary === undefined ? failures : [primary, ...failures];
	return new ModelNetworkFailure('cleanup_failed', undefined, {
		cause: reasons.length === 1 ? reasons[0] : new AggregateError(reasons, 'Model response cleanup failed'),
	});
}

export function modelSdkFailure(error: unknown, signal: AbortSignal): ModelNetworkFailure {
	if (error instanceof ModelNetworkFailure) {
		return error;
	}

	const failure = (kind: ModelNetworkFailure['kind']) => new ModelNetworkFailure(kind, undefined, { cause: error });

	if (
		signal.aborted ||
		error instanceof OpenAI.APIConnectionTimeoutError ||
		error instanceof OpenAI.APIUserAbortError
	) {
		return failure('timeout');
	}
	if (error instanceof OpenAI.APIError && error.status !== undefined) {
		// Inspect structured provider codes only. Messages can contain prompts or
		// credentials and are neither a stable classification nor safe diagnostics.
		if (error.code === 'moderation_blocked' || error.code === 'content_policy_violation') {
			return new ModelNetworkFailure('content_filtered', error.status, { cause: error });
		}
		return new ModelNetworkFailure('http', error.status, { cause: error });
	}
	if (error instanceof SyntaxError) {
		return failure('response_invalid');
	}
	let cause: unknown = error;
	for (let depth = 0; depth < 6; depth++) {
		if (cause instanceof ModelNetworkFailure) {
			return cause;
		}
		if (cause === null || typeof cause !== 'object') {
			break;
		}
		const code = 'code' in cause ? cause.code : undefined;
		if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
			return failure('dns');
		}
		if (
			typeof code === 'string' &&
			/^(ERR_TLS_|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)/.test(code)
		) {
			return failure('tls');
		}
		if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
			return failure('timeout');
		}
		cause = 'cause' in cause ? cause.cause : undefined;
	}
	// SDK errors without an HTTP status can originate from in-stream provider errors.
	return failure(
		error instanceof OpenAI.APIError && !(error instanceof OpenAI.APIConnectionError)
			? 'response_invalid'
			: 'network',
	);
}

/** Each response owns its reader, including cancellation suppressed by SDK cleanup. */
class ModelResponseBody {
	private closing: Promise<void> | null = null;
	private ended = false;
	private cancelled = false;
	private readonly reader: ReadableStreamDefaultReader<Uint8Array> | NodeReadableStreamDefaultReader<unknown>;
	private readonly readerSettled: Promise<void>;
	private readerFailure: { error: unknown } | null = null;
	private readonly utf8 = new TextDecoder('utf-8', { fatal: true });
	readonly stream: ReadableStream<Uint8Array>;

	constructor(
		body: ReadableStream<Uint8Array> | NodeReadableStream<unknown>,
		signal: AbortSignal,
		consume: (bytes: number) => void,
		fail: (error: unknown) => ModelNetworkFailure,
	) {
		this.reader = body.getReader();
		this.readerSettled = this.reader.closed.then(
			() => undefined,
			(error: unknown) => {
				this.readerFailure = { error };
			},
		);
		this.stream = new ReadableStream<Uint8Array>(
			{
				pull: async (controller) => {
					try {
						const part = await this.reader.read();
						if (this.cancelled) {
							return;
						}
						if (signal.aborted) {
							throw new ModelNetworkFailure('timeout');
						}
						if (part.done) {
							this.validateEncoding();
							this.ended = true;
							controller.close();
							return;
						}
						if (!(part.value instanceof Uint8Array)) {
							throw new ModelNetworkFailure('response_invalid');
						}
						consume(part.value.byteLength);
						this.validateEncoding(part.value);
						controller.enqueue(part.value);
					} catch (error) {
						controller.error(fail(error));
					}
				},

				cancel: () => this.close(),
			},
			{ highWaterMark: 0 },
		);
	}

	private validateEncoding(bytes?: Uint8Array): void {
		try {
			this.utf8.decode(bytes, { stream: bytes !== undefined });
		} catch (cause) {
			throw new ModelNetworkFailure('response_invalid', undefined, { cause });
		}
	}

	close(): Promise<void> {
		if (this.closing) {
			return this.closing;
		}
		this.cancelled = true;
		this.closing = Promise.resolve().then(async () => {
			const failures: unknown[] = [];
			if (!this.ended) {
				try {
					await this.reader.cancel();
				} catch (error) {
					// cancel() on an already errored stream rejects with its stored
					// read error (including fetch abort). That is not a second cleanup
					// failure. A failing underlying cancel closes reader.closed normally
					// and must still be reported, even when the application aborted.
					await this.readerSettled;
					if (this.readerFailure === null || this.readerFailure.error !== error) {
						failures.push(error);
					}
				}
			}
			try {
				this.reader.releaseLock();
			} catch (error) {
				failures.push(error);
			}
			if (failures.length) {
				throw modelCleanupFailure(failures);
			}
		});
		return this.closing;
	}
}

/** SDK owns bounded backoff; this owner fences local failures and drains every attempt. */
export class ModelSdkRequest {
	readonly client: OpenAI;
	readonly requestSignal: AbortSignal;
	private readonly dispatcher: Agent | null;
	bytes = 0;
	private responseBody: ModelResponseBody | null = null;
	private closing: Promise<void> | null = null;
	private accepted = false;
	private attempts = 0;
	private localFailure: ModelNetworkFailure | null = null;
	private readonly stopRetries = new AbortController();

	constructor(
		baseUrl: string,
		credential: string | null,
		private readonly signal: AbortSignal,
		private readonly maxBytes: number,
		private readonly streaming: boolean,
		private readonly logger?: Logger,
		applicationDeadline = false,
	) {
		const url = new URL(baseUrl);
		if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
			throw new ModelNetworkFailure('response_invalid');
		}
		// Silent image generation uses the task deadline without changing other requests' pooling.
		this.dispatcher = applicationDeadline
			? new Agent({ connections: 1, pipelining: 1, headersTimeout: 0, bodyTimeout: 0 })
			: null;
		this.requestSignal = AbortSignal.any([signal, this.stopRetries.signal]);
		this.client = new OpenAI({
			baseURL: url.href.replace(/\/$/, ''),
			apiKey: credential ?? 'nexus-anonymous-provider',
			organization: null,
			project: null,
			maxRetries: streaming ? 2 : 0,
			// The application owns the full deadline, including all SDK backoff.
			timeout: 2_147_483_647,
			logLevel: 'off',

			fetch: async (input, init) => {
				try {
					if (this.requestSignal.aborted) {
						throw this.localFailure ?? new ModelNetworkFailure('timeout');
					}
					if (this.closing || this.accepted) {
						throw new ModelNetworkFailure('response_invalid');
					}
					// The SDK may suppress cancellation failures. Rejoin the same cleanup
					// before any subsequent dispatch so a failed reader cannot be replaced.
					await this.responseBody?.close();
					this.responseBody = null;
					if (this.requestSignal.aborted) {
						throw this.localFailure ?? new ModelNetworkFailure('timeout');
					}
					if (
						typeof init?.body === 'string' &&
						Buffer.byteLength(init.body, 'utf8') > MODEL_STREAM_MAX_BYTES
					) {
						throw new ModelNetworkFailure('too_large');
					}
					if (this.dispatcher !== null && init?.body != null && typeof init.body !== 'string') {
						throw new ModelNetworkFailure('response_invalid');
					}
				} catch (error) {
					throw this.failLocally(error);
				}
				const headers = new Headers(init?.headers);
				if (this.streaming) {
					headers.set('accept', 'text/event-stream');
				}
				if (credential === null) {
					headers.delete('authorization');
				}
				this.attempts++;
				logDiagnostic(this.logger, 'debug', 'MODEL_HTTP_DISPATCH', {
					attempt: this.attempts,
				});
				let response: Response | Awaited<ReturnType<typeof undiciFetch>>;
				try {
					// Local retry cancellation must not error the raw reader before
					// its owner can drain it. The application signal owns transport
					// cancellation and the full deadline; requestSignal fences SDK backoff.
					if (this.dispatcher === null) {
						response = await fetch(input, { ...init, signal: this.signal, headers, redirect: 'error' });
					} else {
						// Pair the owned Agent with its own Undici implementation. Node's
						// built-in fetch may use a different Dispatcher contract/version.
						response = await undiciFetch(
							typeof input === 'string' || input instanceof URL ? input : input.url,
							{
								method: init?.method,
								body: typeof init?.body === 'string' ? init.body : null,
								headers: [...headers],
								signal: this.signal,
								redirect: 'error',
								dispatcher: this.dispatcher,
							},
						);
					}
				} catch (error) {
					const failure = modelSdkFailure(error, this.signal);
					logDiagnostic(
						this.logger,
						'warn',
						'MODEL_HTTP_CONNECTION_FAILED',
						{
							attempt: this.attempts,
							aborted: this.signal.aborted,
						},
						failure,
					);
					// Certificate errors cannot improve with backoff. Other pre-response
					// connection failures use the SDK's limited retry policy.
					if (failure.kind === 'tls' || this.signal.aborted) {
						throw this.failLocally(failure);
					}
					throw failure;
				}
				try {
					this.accepted = response.ok;
					logDiagnostic(this.logger, response.ok ? 'debug' : 'warn', 'MODEL_HTTP_RESPONSE', {
						method: init?.method ?? 'GET',
						status: response.status,
						attempt: this.attempts,
					});
					if (response.body) {
						this.responseBody = new ModelResponseBody(
							response.body,
							this.requestSignal,
							(bytes) => {
								this.bytes += bytes;
								if (this.bytes > this.maxBytes) {
									throw new ModelNetworkFailure('too_large');
								}
							},
							(error) => this.failLocally(error),
						);
					} else if (response.ok) {
						throw new ModelNetworkFailure('response_invalid');
					}
					const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
					const declared = Number(response.headers.get('content-length') ?? 0);
					if (Number.isFinite(declared) && declared > this.maxBytes - this.bytes) {
						throw new ModelNetworkFailure('too_large');
					}
					if (response.ok && this.streaming && contentType !== 'text/event-stream') {
						throw new ModelNetworkFailure('response_invalid');
					}
					const responseHeaders = new Headers([...response.headers]);
					// A compatible provider cannot force retries for authentication or
					// input failures via x-should-retry. Backoff itself remains SDK-owned.
					const transient = [408, 409, 429].includes(response.status) || response.status >= 500;
					if (!transient) {
						responseHeaders.set('x-should-retry', 'false');
					}
					return new Response(this.responseBody?.stream ?? null, {
						status: response.status,
						statusText: response.statusText,
						headers: responseHeaders,
					});
				} catch (error) {
					throw this.failLocally(error);
				}
			},
		});
	}

	private failLocally(error: unknown): ModelNetworkFailure {
		this.localFailure ??= modelSdkFailure(error, this.signal);
		this.stopRetries.abort();
		return this.localFailure;
	}

	async close(primary?: ModelNetworkFailure): Promise<void> {
		this.closing ??= Promise.resolve().then(async () => {
			const failures: unknown[] = [];
			try {
				await this.responseBody?.close();
			} catch (error) {
				failures.push(error);
			}
			try {
				await this.dispatcher?.destroy();
			} catch (error) {
				failures.push(error);
			}
			if (failures.length === 1) {
				throw failures[0];
			}
			if (failures.length) {
				throw modelCleanupFailure(failures);
			}
		});
		let cleanupError: unknown;
		try {
			await this.closing;
		} catch (error) {
			cleanupError = error;
		}
		const failure = this.localFailure ?? primary;
		if (cleanupError !== undefined) {
			if (cleanupError === failure) {
				throw failure;
			}
			throw modelCleanupFailure([cleanupError], failure);
		}
		if (failure) {
			throw failure;
		}
		if (this.signal.aborted) {
			throw new ModelNetworkFailure('timeout');
		}
	}
}
