import { MODELS_DEV_CATALOG_URL } from '../catalog-port.js';
import type { CatalogFetchResult, ModelCatalogPort, CatalogEntry, CatalogModelCapabilities } from '../catalog-port.js';
import { CatalogFailure } from '../catalog-port.js';

/** Official source is a technical adapter setting; never inferred from a model identifier. */
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;

const PROVIDERS = [
	'openai',
	'anthropic',
	'google',
	'deepseek',
	'xai',
	'moonshotai',
	'alibaba',
	'minimax',
	'mistral',
	'cohere',
	'amazon',
	'zhipuai',
	'meta',
	'microsoft',
	'nvidia',
	'bytedance-seed',
	'opencode',
] as const;
const REASONING = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | null {
	return isRecord(value) ? value : null;
}

function positive(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function defaults(raw: unknown): CatalogModelCapabilities | null {
	const entry = record(raw);
	const limit = record(entry?.limit);
	if (
		!entry ||
		!limit ||
		!positive(limit.context) ||
		!positive(limit.output) ||
		limit.output > limit.context ||
		(entry.tool_call !== undefined && typeof entry.tool_call !== 'boolean')
	) {
		return null;
	}
	const modalities = record(entry.modalities);
	const input = modalities?.input;
	if (input !== undefined && (!Array.isArray(input) || input.some((value) => typeof value !== 'string'))) {
		return null;
	}
	const inputs = Array.isArray(input) ? input : undefined;
	let reasoningEfforts: CatalogModelCapabilities['reasoningEfforts'];
	if (entry.reasoning === true && Array.isArray(entry.reasoning_options)) {
		for (const option of entry.reasoning_options) {
			const o = record(option);
			if (o?.type === 'effort' && Array.isArray(o.values)) {
				const recognized = o.values.filter(
					(value): value is (typeof REASONING)[number] =>
						typeof value === 'string' && REASONING.some((effort) => effort === value),
				);
				if (recognized.length) {
					reasoningEfforts = [...new Set(recognized)];
					break;
				}
			}
		}
	}
	return {
		contextWindow: limit.context,
		maxOutputTokens: limit.output,
		...(entry.tool_call === undefined ? {} : { supportsTools: entry.tool_call }),
		...(inputs === undefined ? {} : { supportsImageInput: inputs.includes('image') }),
		...(inputs === undefined ? {} : { supportsFileInput: inputs.includes('file') || inputs.includes('pdf') }),
		...(reasoningEfforts ? { reasoningEfforts } : {}),
	};
}

function parseCatalog(body: unknown): CatalogEntry[] {
	const root = record(body);
	if (!root) {
		throw new CatalogFailure('response_invalid');
	}
	const entries: CatalogEntry[] = [];
	for (const providerId of PROVIDERS) {
		const models = record(record(root[providerId])?.models);
		if (!models) {
			continue;
		}
		for (const [modelId, raw] of Object.entries(models)) {
			if (!modelId.trim() || Buffer.byteLength(modelId, 'utf8') > 256) {
				continue;
			}
			const capabilities = defaults(raw);
			if (capabilities) {
				entries.push({ providerId, modelId, capabilities });
			}
		}
	}
	if (entries.length < 1 || entries.length > 5000) {
		throw new CatalogFailure('response_invalid');
	}
	return entries;
}

function cleanupFailure(errors: unknown[], primary?: unknown): CatalogFailure {
	const causes = primary === undefined ? errors : [primary, ...errors];
	return new CatalogFailure('cleanup_failed', undefined, {
		cause: causes.length === 1 ? causes[0] : new AggregateError(causes, 'Catalog response cleanup failed'),
	});
}

async function discardBody(response: Response, primary?: CatalogFailure): Promise<void> {
	try {
		await response.body?.cancel();
	} catch (error) {
		throw cleanupFailure([error], primary);
	}
}

export class ModelsDevCatalogAdapter implements ModelCatalogPort {
	async fetch(revision: string | null, signal: AbortSignal): Promise<CatalogFetchResult> {
		let response: Response;
		try {
			response = await fetch(MODELS_DEV_CATALOG_URL, {
				redirect: 'error',
				signal,
				headers: {
					accept: 'application/json',
					...(revision === null ? {} : { 'if-none-match': revision }),
				},
			});
		} catch (cause) {
			throw new CatalogFailure('network', undefined, { cause });
		}
		if (response.status === 304) {
			await discardBody(response);
			return { status: 'not-modified', sourceRevision: response.headers.get('etag') ?? revision };
		}
		if (!response.ok) {
			const failure = new CatalogFailure('http', response.status);
			await discardBody(response, failure);
			throw failure;
		}
		const declared = Number(response.headers.get('content-length') ?? 0);
		if (Number.isFinite(declared) && declared > MAX_CATALOG_BYTES) {
			const failure = new CatalogFailure('too_large');
			await discardBody(response, failure);
			throw failure;
		}
		const reader = response.body?.getReader();
		if (!reader) {
			throw new CatalogFailure('response_invalid');
		}
		const chunks: Uint8Array[] = [];
		let count = 0;
		let primary: CatalogFailure | undefined;
		try {
			for (;;) {
				if (signal.aborted) {
					throw new CatalogFailure('network');
				}
				const item = await reader.read();
				if (item.done) {
					break;
				}
				count += item.value.byteLength;
				if (count > MAX_CATALOG_BYTES) {
					throw new CatalogFailure('too_large');
				}
				chunks.push(item.value);
			}
		} catch (error) {
			primary =
				error instanceof CatalogFailure ? error : new CatalogFailure('network', undefined, { cause: error });
		} finally {
			const errors: unknown[] = [];
			if (primary) {
				try {
					await reader.cancel();
				} catch (error) {
					errors.push(error);
				}
			}
			try {
				reader.releaseLock();
			} catch (error) {
				errors.push(error);
			}
			if (errors.length) {
				throw cleanupFailure(errors, primary);
			}
		}
		if (primary) {
			throw primary;
		}
		if (signal.aborted) {
			throw new CatalogFailure('network');
		}
		const full = new Uint8Array(count);
		let at = 0;
		for (const item of chunks) {
			full.set(item, at);
			at += item.byteLength;
		}
		let body: unknown;
		try {
			body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(full));
		} catch {
			throw new CatalogFailure('response_invalid');
		}
		return {
			status: 'updated',
			sourceRevision: response.headers.get('etag'),
			entries: parseCatalog(body),
		};
	}
}
