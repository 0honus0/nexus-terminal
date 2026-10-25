import { decodeModelImage } from './model-image.js';
import { Stream } from 'openai/core/streaming';
import { MODEL_IMAGE_MAX_RESPONSE_BYTES, MODEL_STREAM_MAX_BYTES, ModelNetworkFailure } from '../model-port.js';
import type { Logger } from '../../logging/logger.js';
import { logDiagnostic } from '../../logging/diagnostic-log.js';
import { chatModelRequest, responseModelRequest } from './model-request.js';
import { ModelStreamProjection } from './model-stream.js';
import { ModelSdkRequest, modelSdkFailure } from './model-sdk-request.js';
import type {
	EndpointModel,
	ModelNetworkPort,
	ModelProbe,
	ModelProbeResult,
	ModelStreamInput,
	ModelStreamEvent,
	ModelImageRequest,
	ModelImageResult,
} from '../model-port.js';

const LIMIT_MODELS = 1024 * 1024;
const LIMIT_PROBE = 512 * 1024;
const MAX_MODELS = 1000;

const isNonemptyText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const isPositiveInteger = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | null {
	return isRecord(value) ? value : null;
}

function metadata(raw: unknown): EndpointModel['capabilities'] {
	if (raw === undefined || raw === null) {
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
					'supports_image_generation',
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
		['supports_image_generation', 'supportsImageGeneration'],
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

export class OpenAiCompatibleAdapter implements ModelNetworkPort {
	constructor(private readonly logger?: Logger) {}

	private async request<T>(
		baseUrl: string,
		credential: string | null,
		signal: AbortSignal,
		maxBytes: number,
		work: (request: ModelSdkRequest) => Promise<T>,
	): Promise<T> {
		const request = new ModelSdkRequest(baseUrl, credential, signal, maxBytes, false, this.logger);
		let primary: ModelNetworkFailure | undefined;
		try {
			return await work(request);
		} catch (error) {
			primary = modelSdkFailure(error, signal);
			logDiagnostic(this.logger, 'warn', 'MODEL_HTTP_FAILED', { aborted: signal.aborted }, primary);
			throw primary;
		} finally {
			await request.close(primary);
		}
	}

	async generateImage(input: ModelImageRequest, signal: AbortSignal): Promise<ModelImageResult> {
		return this.request(
			input.baseUrl,
			input.credential,
			signal,
			MODEL_IMAGE_MAX_RESPONSE_BYTES,
			async (request) => {
				const image = await request.client.images.generate(
					{
						model: input.modelId,
						prompt: input.prompt,
						n: 1,
						...(input.modelId.toLowerCase().split('/').at(-1)?.startsWith('gpt-image-')
							? {}
							: { response_format: 'b64_json' as const }),
					},
					{ signal },
				);
				return decodeModelImage(image);
			},
		);
	}

	private async *streamModel(
		input: ModelStreamInput,
		signal: AbortSignal,
		maxBytes: number,
	): AsyncIterable<ModelStreamEvent> {
		if (input.protocol === 'images') {
			throw new ModelNetworkFailure('response_invalid');
		}
		const request = new ModelSdkRequest(input.baseUrl, input.credential, signal, maxBytes, true, this.logger);
		const projection = new ModelStreamProjection(input.protocol, input.tools.length > 0);
		let primary: ModelNetworkFailure | undefined;
		let ended = false;
		let finalEvents: ModelStreamEvent[] = [];
		const controller = new AbortController();
		try {
			const sdkResponse =
				input.protocol === 'responses'
					? request.client.responses.create(responseModelRequest(input), { signal })
					: request.client.chat.completions.create(chatModelRequest(input), { signal });
			// Keep event names supplied by the SDK so named failures or mismatched
			// Responses events cannot masquerade as successful text deltas.
			const stream = Stream.fromSSEResponse<unknown>(
				await sdkResponse.asResponse(),
				controller,
				request.client,
				true,
			);
			for await (const event of stream) {
				if (signal.aborted) {
					throw new ModelNetworkFailure('timeout');
				}
				for (const output of projection.accept(event)) {
					yield output;
				}
			}
			if (signal.aborted) {
				throw new ModelNetworkFailure('timeout');
			}
			finalEvents = projection.finish();
			ended = true;
		} catch (error) {
			primary = modelSdkFailure(error, signal);
			throw primary;
		} finally {
			controller.abort();
			try {
				await request.close(primary);
			} catch (error) {
				primary = modelSdkFailure(error, signal);
				throw primary;
			} finally {
				logDiagnostic(
					this.logger,
					primary || !ended ? 'warn' : 'debug',
					'MODEL_STREAM_SETTLED',
					{
						bytes: request.bytes,
						ended,
						failed: primary !== undefined,
						aborted: signal.aborted,
					},
					primary,
				);
			}
		}
		for (const event of finalEvents) {
			yield event;
		}
	}

	stream(input: ModelStreamInput, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
		return this.streamModel(input, signal, MODEL_STREAM_MAX_BYTES);
	}

	async discover(baseUrl: string, credential: string | null, signal: AbortSignal): Promise<EndpointModel[]> {
		return this.request(baseUrl, credential, signal, LIMIT_MODELS, async (request) => {
			// Read exactly one bounded response; SDK auto-pagination is deliberately not consumed.
			const page: unknown = await request.client.models.list({ signal });
			const raw = record(page);
			if (!raw || !Array.isArray(raw.data) || raw.data.length > MAX_MODELS) {
				throw new ModelNetworkFailure('response_invalid');
			}
			const models = new Map<string, EndpointModel>();
			for (const item of raw.data) {
				const model = record(item);
				if (!model || !isNonemptyText(model.id) || Buffer.byteLength(model.id, 'utf8') > 512) {
					throw new ModelNetworkFailure('response_invalid');
				}
				const id = model.id.trim();
				if (models.has(id)) {
					throw new ModelNetworkFailure('response_invalid');
				}
				let ownedBy: string | undefined;
				if (model.owned_by !== undefined && model.owned_by !== null) {
					if (!isNonemptyText(model.owned_by) || Buffer.byteLength(model.owned_by, 'utf8') > 512) {
						throw new ModelNetworkFailure('response_invalid');
					}
					ownedBy = model.owned_by;
				}
				let createdAt: number | undefined;
				if (model.created !== undefined && model.created !== null) {
					if (
						typeof model.created !== 'number' ||
						!Number.isSafeInteger(model.created) ||
						model.created < 0
					) {
						throw new ModelNetworkFailure('response_invalid');
					}
					createdAt = model.created;
				}
				const capabilities = metadata(model.nexus_capabilities);
				models.set(id, {
					id,
					...(ownedBy === undefined ? {} : { ownedBy }),
					...(createdAt === undefined ? {} : { createdAt }),
					...(capabilities === undefined ? {} : { capabilities }),
				});
			}
			return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
		});
	}

	async probe(input: ModelProbe, signal: AbortSignal): Promise<ModelProbeResult> {
		if (input.protocol === 'images') {
			await this.generateImage(
				{
					baseUrl: input.baseUrl,
					credential: input.credential,
					modelId: input.modelId,
					prompt: 'A small blue circle on a white background.',
				},
				signal,
			);
			return {};
		}
		let usage: ModelProbeResult['usage'];
		for await (const event of this.streamModel(
			{
				baseUrl: input.baseUrl,
				credential: input.credential,
				modelId: input.modelId,
				protocol: input.protocol,
				maxOutputTokens: Math.min(input.maxOutputTokens, 16),
				usesReasoning: input.usesReasoning,
				...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
				messages: [{ role: 'user', content: 'Reply with OK.' }],
				tools: [],
			},
			signal,
			LIMIT_PROBE,
		)) {
			if (event.type === 'usage') {
				if (usage) {
					throw new ModelNetworkFailure('response_invalid');
				}
				usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
			} else if (event.type === 'completed' && event.finishReason !== 'stop') {
				throw new ModelNetworkFailure('response_invalid');
			}
		}
		return usage ? { usage } : {};
	}
}
