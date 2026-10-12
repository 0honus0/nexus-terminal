/** Third-party technical facts only: no Agent identity or execution policy. */
export interface EndpointModel {
	id: string;
	ownedBy?: string;
	createdAt?: number;
	capabilities?: {
		contextWindow?: number;
		maxOutputTokens?: number;
		supportsTools?: boolean;
		supportsImageInput?: boolean;
		supportsFileInput?: boolean;
		supportsPromptCacheKey?: boolean;
		reasoningEfforts?: ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[];
		defaultReasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
		reasoningMandatory?: boolean;
	};
}

export interface ModelProbe {
	baseUrl: string;
	protocol: 'responses' | 'chat-completions';
	modelId: string;
	credential: string | null;
	maxOutputTokens: number;
	usesReasoning: boolean;
	reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/** Usage is absent when the provider did not report it, never fabricated as zero. */
export interface ModelProbeResult {
	usage?: { inputTokens: number; outputTokens: number };
}

/** Success requires a completed event and normal iterator termination; EOF alone is not success. */
export const MODEL_STREAM_MAX_BYTES = 8 * 1024 * 1024;

export const MODEL_STREAM_MAX_TEXT_BYTES = 2 * 1024 * 1024;

export const MODEL_STREAM_MAX_DELTA_FRAME_BYTES = 128 * 1024;

export interface ModelStreamInput extends ModelProbe {
	prompt: string;
}

export type ModelStreamEvent =
	| { type: 'text_delta'; text: string }
	| { type: 'usage'; inputTokens: number; outputTokens: number }
	| { type: 'completed'; finishReason: 'stop' | 'length' | 'content_filter' };

export interface ModelNetworkPort {
	discover(baseUrl: string, credential: string | null, signal: AbortSignal): Promise<EndpointModel[]>;
	probe(input: ModelProbe, signal: AbortSignal): Promise<ModelProbeResult>;
	/** The consumer owns the iterator lifecycle; cancellation never proves remote rollback. */
	stream(input: ModelStreamInput, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
}

export class ModelNetworkFailure extends Error {
	constructor(
		readonly kind:
			| 'http'
			| 'dns'
			| 'tls'
			| 'network'
			| 'timeout'
			| 'response_invalid'
			| 'response_empty'
			| 'stream_truncated'
			| 'too_large'
			| 'cleanup_failed',
		readonly httpStatus?: number,
		options?: ErrorOptions,
	) {
		super('Model network: ' + kind, options);
		this.name = 'ModelNetworkFailure';
	}
}
