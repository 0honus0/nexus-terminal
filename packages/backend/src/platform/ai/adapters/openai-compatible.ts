import type { ReadableStreamReadResult } from 'node:stream/web';
import { modelRequest } from './model-request.js';
import type {
	EndpointModel,
	ModelNetworkPort,
	ModelProbe,
	ModelProbeResult,
	ModelStreamInput,
	ModelStreamEvent,
} from '../model-port.js';
import { ModelNetworkFailure } from '../model-port.js';
import { MODEL_STREAM_MAX_BYTES } from '../model-port.js';
import { ModelStreamDecoder } from './model-stream.js';

const LIMIT_MODELS = 1024 * 1024;
const LIMIT_STREAM = 512 * 1024;
const MAX_MODELS = 1000;

const isNonemptyText = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | null {
	return isRecord(value) ? value : null;
}

const isPositiveInteger = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0;

/** Preserve every cleanup failure and, when present, the primary operation failure. */
function cleanupFailure(failures: unknown[], primary?: unknown): ModelNetworkFailure {
	const reasons = primary === undefined ? failures : [primary, ...failures];
	return new ModelNetworkFailure('cleanup_failed', undefined, {
		cause: reasons.length === 1 ? reasons[0] : new AggregateError(reasons, 'Model response cleanup failed'),
	});
}

const mapError = (err: unknown, signal: AbortSignal): ModelNetworkFailure => {
	if (err instanceof ModelNetworkFailure) {
		return err;
	}

	const failure = (kind: ModelNetworkFailure['kind']) => new ModelNetworkFailure(kind, undefined, { cause: err });

	if (signal.aborted) {
		return failure('timeout');
	}
	let e: unknown = err;
	for (let i = 0; i < 5; i++) {
		const r = record(e);
		if (!r) {
			break;
		}
		const c = r.code;
		if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') {
			return failure('dns');
		}
		if (
			typeof c === 'string' &&
			/^(ERR_TLS_|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)/.test(c)
		) {
			return failure('tls');
		}
		if (c === 'ETIMEDOUT' || c === 'UND_ERR_CONNECT_TIMEOUT' || c === 'UND_ERR_HEADERS_TIMEOUT') {
			return failure('timeout');
		}
		e = r.cause;
	}
	return failure('network');
};

function endpoint(baseUrl: string, path: string): string {
	const u = new URL(baseUrl);
	if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) {
		throw new ModelNetworkFailure('response_invalid');
	}
	return u.href.replace(/\/$/, '') + '/' + path;
}

async function request(
	url: string,
	credential: string | null,
	signal: AbortSignal,
	method: 'GET' | 'POST',
	body?: string,
): Promise<Response> {
	try {
		const res = await fetch(url, {
			method,
			headers: {
				accept: method === 'GET' ? 'application/json' : 'text/event-stream',
				...(body === undefined ? {} : { 'content-type': 'application/json' }),
				...(credential === null ? {} : { authorization: 'Bearer ' + credential }),
			},
			...(body === undefined ? {} : { body }),
			redirect: 'error',
			signal,
		});
		if (!res.ok) {
			const primary = new ModelNetworkFailure('http', res.status);
			try {
				await res.body?.cancel();
			} catch (cleanupError) {
				throw cleanupFailure([cleanupError], primary);
			}
			throw primary;
		}
		return res;
	} catch (error) {
		throw mapError(error, signal);
	}
}

/** Probe and Run streaming reject the same MIME mismatch with identical cleanup. */
async function requireEventStream(response: Response): Promise<void> {
	if (response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'text/event-stream') {
		return;
	}
	const primary = new ModelNetworkFailure('response_invalid');
	try {
		await response.body?.cancel();
	} catch (cleanupError) {
		throw cleanupFailure([cleanupError], primary);
	}
	throw primary;
}

async function bounded(response: Response, max: number, signal: AbortSignal): Promise<Uint8Array> {
	const reader = response.body?.getReader();
	if (!reader) {
		throw new ModelNetworkFailure('response_invalid');
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	let primaryError: unknown;
	let didFail = false;
	try {
		const length = Number(response.headers.get('content-length') ?? 0);
		if (Number.isFinite(length) && length > max) {
			throw new ModelNetworkFailure('too_large');
		}
		for (;;) {
			if (signal.aborted) {
				throw new ModelNetworkFailure('timeout');
			}
			const part = await reader.read();
			if (part.done) {
				break;
			}
			total += part.value.byteLength;
			if (total > max) {
				throw new ModelNetworkFailure('too_large');
			}
			chunks.push(part.value);
		}
	} catch (error) {
		didFail = true;
		primaryError = mapError(error, signal);
	} finally {
		const cleanupErrors: unknown[] = [];
		if (didFail) {
			try {
				await reader.cancel();
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		try {
			reader.releaseLock();
		} catch (error) {
			cleanupErrors.push(error);
		}
		if (cleanupErrors.length) {
			throw cleanupFailure(cleanupErrors, didFail ? primaryError : undefined);
		}
	}
	if (didFail) {
		throw primaryError;
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.byteLength;
	}
	return out;
}

function metadata(raw: unknown): EndpointModel['capabilities'] {
	if (raw === undefined) {
		return undefined;
	}
	const r = record(raw);
	if (
		!r ||
		r.schema_version !== 1 ||
		Object.keys(r).some(
			(k) =>
				![
					'schema_version',
					'context_window',
					'max_output_tokens',
					'supports_tools',
					'supports_image_input',
					'supports_file_input',
					'supports_prompt_cache_key',
					'reasoning',
				].includes(k),
		)
	) {
		throw new ModelNetworkFailure('response_invalid');
	}
	const capabilities: NonNullable<EndpointModel['capabilities']> = {};
	for (const [src, dst] of [
		['context_window', 'contextWindow'],
		['max_output_tokens', 'maxOutputTokens'],
	] as const) {
		if (r[src] !== undefined) {
			if (!isPositiveInteger(r[src])) {
				throw new ModelNetworkFailure('response_invalid');
			}
			capabilities[dst] = r[src];
		}
	}
	for (const [src, dst] of [
		['supports_tools', 'supportsTools'],
		['supports_image_input', 'supportsImageInput'],
		['supports_file_input', 'supportsFileInput'],
		['supports_prompt_cache_key', 'supportsPromptCacheKey'],
	] as const) {
		if (r[src] !== undefined) {
			const value = r[src];
			if (typeof value !== 'boolean') {
				throw new ModelNetworkFailure('response_invalid');
			}
			capabilities[dst] = value;
		}
	}
	if (r.reasoning !== undefined) {
		const reasoning = record(r.reasoning);
		const options = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
		if (
			!reasoning ||
			Object.keys(reasoning).some((k) => !['supported_efforts', 'default_effort', 'mandatory'].includes(k)) ||
			!Array.isArray(reasoning.supported_efforts) ||
			reasoning.supported_efforts.length < 1 ||
			reasoning.supported_efforts.length > options.length
		) {
			throw new ModelNetworkFailure('response_invalid');
		}
		const efforts = reasoning.supported_efforts;
		if (
			efforts.some((effort: unknown) => !options.some((o) => o === effort)) ||
			new Set(efforts).size !== efforts.length
		) {
			throw new ModelNetworkFailure('response_invalid');
		}
		capabilities.reasoningEfforts = options.filter((o) => efforts.includes(o));
		if (reasoning.default_effort !== undefined) {
			const defaultEffort = capabilities.reasoningEfforts.find((effort) => effort === reasoning.default_effort);
			if (defaultEffort === undefined) {
				throw new ModelNetworkFailure('response_invalid');
			}
			capabilities.defaultReasoningEffort = defaultEffort;
		}
		if (reasoning.mandatory !== undefined) {
			if (typeof reasoning.mandatory !== 'boolean') {
				throw new ModelNetworkFailure('response_invalid');
			}
			capabilities.reasoningMandatory = reasoning.mandatory;
		}
	}
	if (
		Object.keys(capabilities).length === 0 ||
		(capabilities.contextWindow &&
			capabilities.maxOutputTokens &&
			capabilities.maxOutputTokens > capabilities.contextWindow)
	) {
		throw new ModelNetworkFailure('response_invalid');
	}
	return capabilities;
}

function probeBody(input: ModelProbe): string {
	const maxTokens = Math.min(input.maxOutputTokens, 16);
	if (input.protocol === 'responses') {
		return JSON.stringify({
			model: input.modelId,
			input: [{ role: 'user', content: 'Reply with OK.' }],
			max_output_tokens: maxTokens,
			stream: true,
			store: false,
			...(input.reasoningEffort === undefined ? {} : { reasoning: { effort: input.reasoningEffort } }),
		});
	}
	return JSON.stringify({
		model: input.modelId,
		messages: [{ role: 'user', content: 'Reply with OK.' }],
		...(input.usesReasoning ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
		stream: true,
		stream_options: { include_usage: true },
		...(input.reasoningEffort === undefined ? {} : { reasoning_effort: input.reasoningEffort }),
	});
}

/** The Provider probe must use the same strict protocol semantics as a Run stream. */
function parseProbeStream(data: Uint8Array, protocol: ModelProbe['protocol']): ModelProbeResult {
	const decoder = new ModelStreamDecoder(protocol);
	let reported: ModelProbeResult['usage'];
	for (const event of decoder.feed(data)) {
		if (event.type === 'usage') {
			if (reported !== undefined) {
				throw new ModelNetworkFailure('response_invalid');
			}
			reported = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
		}
	}
	const terminal = decoder.finish();
	if (terminal.type !== 'completed' || terminal.finishReason !== 'stop') {
		throw new ModelNetworkFailure('response_invalid');
	}
	return reported === undefined ? {} : { usage: reported };
}

export class OpenAiCompatibleAdapter implements ModelNetworkPort {
	async *stream(input: ModelStreamInput, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
		const responses = input.protocol === 'responses';
		const body = modelRequest(input);
		const response = await request(
			endpoint(input.baseUrl, responses ? 'responses' : 'chat/completions'),
			input.credential,
			signal,
			'POST',
			body,
		);
		await requireEventStream(response);
		const reader = response.body?.getReader();
		if (!reader) {
			throw new ModelNetworkFailure('response_invalid');
		}
		const decoder = new ModelStreamDecoder(input.protocol, input.tools.length > 0);
		let bytes = 0;
		let ended = false;
		let primaryError: unknown;
		let didFail = false;
		try {
			const declared = Number(response.headers.get('content-length') ?? 0);
			if (Number.isFinite(declared) && declared > MODEL_STREAM_MAX_BYTES) {
				throw new ModelNetworkFailure('too_large');
			}
			for (;;) {
				if (signal.aborted) {
					throw new ModelNetworkFailure('timeout');
				}
				let item: ReadableStreamReadResult<Uint8Array>;
				try {
					item = await reader.read();
				} catch (error) {
					throw mapError(error, signal);
				}
				if (item.done) {
					break;
				}
				bytes += item.value.byteLength;
				if (bytes > MODEL_STREAM_MAX_BYTES) {
					throw new ModelNetworkFailure('too_large');
				}
				for (const event of decoder.feed(item.value)) {
					yield event;
				}
			}
			if (signal.aborted) {
				throw new ModelNetworkFailure('timeout');
			}
			const terminal = decoder.finish();
			ended = true;
			yield terminal;
		} catch (error) {
			didFail = true;
			primaryError = error;
		} finally {
			const cleanupErrors: unknown[] = [];
			if (!ended) {
				try {
					await reader.cancel();
				} catch (error) {
					cleanupErrors.push(error);
				}
			}
			try {
				reader.releaseLock();
			} catch (error) {
				cleanupErrors.push(error);
			}
			if (cleanupErrors.length) {
				throw cleanupFailure(cleanupErrors, didFail ? primaryError : undefined);
			}
		}
		if (didFail) {
			throw primaryError;
		}
	}

	async discover(baseUrl: string, credential: string | null, signal: AbortSignal): Promise<EndpointModel[]> {
		const response = await request(endpoint(baseUrl, 'models'), credential, signal, 'GET');
		const bytes = await bounded(response, LIMIT_MODELS, signal);
		let raw: unknown;
		try {
			raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		} catch {
			throw new ModelNetworkFailure('response_invalid');
		}
		const r = record(raw);
		if (!r || !Array.isArray(r.data) || r.data.length > MAX_MODELS) {
			throw new ModelNetworkFailure('response_invalid');
		}
		const map = new Map<string, EndpointModel>();
		for (const item of r.data) {
			const m = record(item);
			if (!m || !isNonemptyText(m.id) || Buffer.byteLength(m.id, 'utf8') > 512) {
				throw new ModelNetworkFailure('response_invalid');
			}
			const id = m.id.trim();
			if (map.has(id)) {
				throw new ModelNetworkFailure('response_invalid');
			}
			let ownedBy: string | undefined;
			if (m.owned_by !== undefined) {
				if (!isNonemptyText(m.owned_by) || Buffer.byteLength(m.owned_by, 'utf8') > 512) {
					throw new ModelNetworkFailure('response_invalid');
				}
				ownedBy = m.owned_by;
			}
			let createdAt: number | undefined;
			if (m.created !== undefined) {
				if (typeof m.created !== 'number' || !Number.isSafeInteger(m.created) || m.created < 0) {
					throw new ModelNetworkFailure('response_invalid');
				}
				createdAt = m.created;
			}
			const capabilities = metadata(m.nexus_capabilities);
			map.set(id, {
				id,
				...(ownedBy === undefined ? {} : { ownedBy }),
				...(createdAt === undefined ? {} : { createdAt }),
				...(capabilities === undefined ? {} : { capabilities }),
			});
		}
		return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
	}

	async probe(input: ModelProbe, signal: AbortSignal): Promise<ModelProbeResult> {
		const isResponses = input.protocol === 'responses';
		const body = probeBody(input);
		const response = await request(
			endpoint(input.baseUrl, isResponses ? 'responses' : 'chat/completions'),
			input.credential,
			signal,
			'POST',
			body,
		);
		await requireEventStream(response);
		const data = await bounded(response, LIMIT_STREAM, signal);
		if (signal.aborted) {
			throw new ModelNetworkFailure('timeout');
		}
		return parseProbeStream(data, input.protocol);
	}
}
