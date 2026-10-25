import OpenAI from 'openai';
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

/** One SDK operation owns one bounded response, including cleanup the SDK may suppress. */
export class ModelSdkRequest {
	readonly client: OpenAI;
	bytes = 0;
	private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	private closing: Promise<void> | null = null;
	private ended = false;
	private cancelled = false;
	private dispatched = false;
	private readFailure: ModelNetworkFailure | null = null;
	private readonly utf8 = new TextDecoder('utf-8', { fatal: true });

	constructor(
		baseUrl: string,
		credential: string | null,
		private readonly signal: AbortSignal,
		private readonly maxBytes: number,
		private readonly streaming: boolean,
		private readonly logger?: Logger,
	) {
		const url = new URL(baseUrl);
		if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
			throw new ModelNetworkFailure('response_invalid');
		}
		this.client = new OpenAI({
			baseURL: url.href.replace(/\/$/, ''),
			apiKey: credential ?? 'nexus-anonymous-provider',
			organization: null,
			project: null,
			maxRetries: 0,
			// The application owns the full deadline; this only prevents SDK's shorter default.
			timeout: 2_147_483_647,
			logLevel: 'off',

			fetch: async (input, init) => {
				if (this.signal.aborted) {
					throw new ModelNetworkFailure('timeout');
				}
				if (this.dispatched) {
					throw new ModelNetworkFailure('response_invalid');
				}
				this.dispatched = true;
				if (typeof init?.body === 'string' && Buffer.byteLength(init.body, 'utf8') > MODEL_STREAM_MAX_BYTES) {
					throw new ModelNetworkFailure('too_large');
				}
				const headers = new Headers(init?.headers);
				if (this.streaming) {
					headers.set('accept', 'text/event-stream');
				}
				if (credential === null) {
					headers.delete('authorization');
				}
				const response = await fetch(input, { ...init, headers, redirect: 'error' });
				logDiagnostic(this.logger, response.ok ? 'debug' : 'warn', 'MODEL_HTTP_RESPONSE', {
					method: init?.method ?? 'GET',
					status: response.status,
				});
				if (!response.body) {
					throw new ModelNetworkFailure(
						response.ok ? 'response_invalid' : 'http',
						response.ok ? undefined : response.status,
					);
				}
				this.reader = response.body.getReader();
				const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
				const declared = Number(response.headers.get('content-length') ?? 0);
				if (
					(Number.isFinite(declared) && declared > this.maxBytes) ||
					(response.ok && this.streaming && contentType !== 'text/event-stream')
				) {
					this.readFailure = new ModelNetworkFailure(
						declared > this.maxBytes ? 'too_large' : 'response_invalid',
					);
					throw this.readFailure;
				}
				const body = new ReadableStream<Uint8Array>(
					{
						pull: async (controller) => {
							try {
								const part = await this.reader?.read();
								if (this.cancelled) {
									return;
								}
								if (this.signal.aborted) {
									throw new ModelNetworkFailure('timeout');
								}
								if (!part) {
									throw new ModelNetworkFailure('response_invalid');
								}
								if (part.done) {
									this.validateEncoding();
									this.ended = true;
									controller.close();
									return;
								}
								this.bytes += part.value.byteLength;
								if (this.bytes > this.maxBytes) {
									throw new ModelNetworkFailure('too_large');
								}
								// Validate encoding without buffering or interpreting the SDK's SSE records.
								this.validateEncoding(part.value);
								controller.enqueue(part.value);
							} catch (error) {
								this.readFailure = modelSdkFailure(error, this.signal);
								controller.error(this.readFailure);
							}
						},

						cancel: () => this.closeReader(),
					},
					{ highWaterMark: 0 },
				);
				return new Response(body, {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
				});
			},
		});
	}

	private validateEncoding(bytes?: Uint8Array): void {
		try {
			this.utf8.decode(bytes, { stream: bytes !== undefined });
		} catch (cause) {
			throw new ModelNetworkFailure('response_invalid', undefined, { cause });
		}
	}

	private closeReader(): Promise<void> {
		if (this.closing) {
			return this.closing;
		}
		this.cancelled = true;
		const reader = this.reader;
		this.closing = Promise.resolve().then(async () => {
			if (!reader) {
				return;
			}
			const failures: unknown[] = [];
			if (!this.ended) {
				try {
					await reader.cancel();
				} catch (error) {
					failures.push(error);
				}
			}
			try {
				reader.releaseLock();
			} catch (error) {
				failures.push(error);
			}
			if (failures.length) {
				throw modelCleanupFailure(failures);
			}
		});
		return this.closing;
	}

	async close(primary?: ModelNetworkFailure): Promise<void> {
		let cleanupError: unknown;
		try {
			await this.closeReader();
		} catch (error) {
			cleanupError = error;
		}
		if (cleanupError !== undefined) {
			throw modelCleanupFailure([cleanupError], primary ?? this.readFailure ?? undefined);
		}
		if (primary) {
			throw primary;
		}
		if (this.signal.aborted) {
			throw new ModelNetworkFailure('timeout');
		}
		if (this.readFailure) {
			throw this.readFailure;
		}
	}
}
