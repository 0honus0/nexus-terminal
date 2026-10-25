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
		supportsImageGeneration?: boolean;
		supportsFileInput?: boolean;
		supportsPromptCacheKey?: boolean;
		reasoningEfforts?: ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[];
		defaultReasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
		reasoningMandatory?: boolean;
	};
}

export interface ModelProbe {
	baseUrl: string;
	protocol: 'responses' | 'chat-completions' | 'images';
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

export interface ModelImageRequest {
	baseUrl: string;
	credential: string | null;
	modelId: string;
	prompt: string;
}

export interface ModelImageResult {
	bytes: Uint8Array;
	mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export const MODEL_IMAGE_MAX_BYTES = 16 * 1024 * 1024;

export const MODEL_IMAGE_MAX_RESPONSE_BYTES = 4 * Math.ceil(MODEL_IMAGE_MAX_BYTES / 3) + 64 * 1024;

/** Success requires a completed event and normal iterator termination; EOF alone is not success. */
export const MODEL_STREAM_MAX_BYTES = 8 * 1024 * 1024;

export const MODEL_STREAM_MAX_TEXT_BYTES = 2 * 1024 * 1024;

export const MODEL_STREAM_MAX_DELTA_FRAME_BYTES = 128 * 1024;

export const MODEL_TOOL_MAX_CALLS = 32;

export const MODEL_TOOL_MAX_DEFINITIONS = 128;

export const MODEL_TOOL_MAX_ARGUMENT_BYTES = 128 * 1024;

export const MODEL_REASONING_MAX_BYTES = 1024 * 1024;

/** Opaque provider continuation evidence; never public application state. */
export interface ModelReasoningState {
	id: string;
	encryptedContent: string;
	summary: string[];
}

export interface ModelToolCall {
	id: string;
	name: string;
	argumentsJson: string;
}

export interface ModelToolDefinition {
	name: string;
	description: string;
	parameters: {
		type: 'object';
		properties: Record<string, ModelToolProperty>;
		required: string[];
		additionalProperties: false;
	};
}

export type ModelToolProperty =
	| {
			type: 'array';
			minItems: number;
			maxItems: number;
			items: { type: 'string'; minLength: number; maxLength: number };
	  }
	| { type: 'integer'; minimum: number; maximum: number }
	| { type: 'string'; minLength: number; maxLength: number };

export type ModelMessage =
	| { role: 'user'; content: string }
	| { role: 'assistant'; content: string; toolCalls: ModelToolCall[]; reasoning: ModelReasoningState[] }
	| { role: 'tool'; callId: string; content: string };

export interface ModelStreamInput extends ModelProbe {
	messages: ModelMessage[];
	tools: ModelToolDefinition[];
}

export type ModelStreamEvent =
	| { type: 'text_delta'; text: string }
	| { type: 'usage'; inputTokens: number; outputTokens: number }
	| { type: 'completed'; finishReason: 'stop' | 'length' | 'content_filter' }
	| { type: 'completed'; finishReason: 'tool_calls'; toolCalls: ModelToolCall[]; reasoning: ModelReasoningState[] };

export interface ModelNetworkPort {
	generateImage(input: ModelImageRequest, signal: AbortSignal): Promise<ModelImageResult>;
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
