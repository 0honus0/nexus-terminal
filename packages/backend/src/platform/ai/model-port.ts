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
	/** Decoded byte budget selected by the application storage owner. */
	maxBytes: number;
}

export interface ModelImageResult {
	bytes: Uint8Array;
	mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
}

/** Success requires a completed event and normal iterator termination; EOF alone is not success. */
export const MODEL_STREAM_MAX_BYTES = 8 * 1024 * 1024;

export const MODEL_STREAM_MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** A batching target for downstream text delivery, not an incoming provider-event ceiling. */
export const MODEL_TEXT_BATCH_BYTES = 128 * 1024;

/** Tool arguments share the complete model transport budget. */
export const MODEL_TOOL_MAX_ARGUMENT_BYTES = MODEL_STREAM_MAX_BYTES;

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
	parameters: ModelToolObject | { schemaJson: string };
}

/** Technical JSON Schema subset understood by both model request adapters. */
export type ModelToolObject = {
	type: 'object';
	description?: string;
	properties: Record<string, ModelToolProperty>;
	required: string[];
	additionalProperties: false;
};

export type ModelToolProperty =
	| ModelToolObject
	| {
			type: 'array';
			description?: string;
			minItems?: number;
			maxItems?: number;
			items: ModelToolProperty;
	  }
	| { type: 'number' | 'integer'; description?: string; minimum?: number; maximum?: number }
	| { type: 'boolean'; description?: string }
	| { type: 'string'; description?: string; minLength?: number; maxLength?: number; enum?: string[] };

export type ModelMessage =
	| { role: 'user'; content: string | ModelUserContentPart[] }
	| { role: 'assistant'; content: string; toolCalls: ModelToolCall[]; reasoning: ModelReasoningState[] }
	| { role: 'tool'; callId: string; content: string };

export type ModelUserContentPart =
	| { type: 'text'; text: string }
	| { type: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; bytes: Uint8Array };

export interface ModelStreamInput extends ModelProbe {
	systemPrompt?: string;
	messages: ModelMessage[];
	tools: ModelToolDefinition[];
}

export type ModelStreamEvent =
	| { type: 'text_delta'; text: string }
	| { type: 'usage'; inputTokens: number; outputTokens: number }
	| { type: 'completed'; finishReason: 'stop'; reasoning: ModelReasoningState[] }
	| { type: 'completed'; finishReason: 'length' | 'content_filter' }
	| { type: 'completed'; finishReason: 'tool_calls'; toolCalls: ModelToolCall[]; reasoning: ModelReasoningState[] };

export interface ModelNetworkPort {
	generateImage(input: ModelImageRequest, signal: AbortSignal): Promise<ModelImageResult>;
	discover(baseUrl: string, credential: string | null, signal: AbortSignal): Promise<EndpointModel[]>;
	probe(input: ModelProbe, signal: AbortSignal): Promise<ModelProbeResult>;
	/** The consumer owns the iterator lifecycle; cancellation never proves remote rollback. */
	stream(input: ModelStreamInput, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
}

export class ModelNetworkFailure extends Error {
	/** Only an actual pre-stream refusal response proves this request was rejected. */
	readonly outcome: 'rejected' | 'unknown';

	constructor(
		readonly kind:
			| 'http'
			| 'content_filtered'
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
		options?: ErrorOptions & { outcome?: 'rejected' | 'unknown' },
	) {
		super('Model network: ' + kind, options);
		this.name = 'ModelNetworkFailure';
		this.outcome = options?.outcome ?? 'unknown';
	}
}
