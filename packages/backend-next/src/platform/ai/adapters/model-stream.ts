import { ModelToolStream } from './model-tool-stream.js';
import { responseReasoning } from './model-reasoning.js';
import type { ModelStreamEvent, ModelStreamInput, ModelReasoningState } from '../model-port.js';
import { ModelNetworkFailure } from '../model-port.js';
import {
	MODEL_STREAM_MAX_BYTES,
	MODEL_STREAM_MAX_DELTA_FRAME_BYTES,
	MODEL_STREAM_MAX_TEXT_BYTES,
} from '../model-port.js';

/** Protocol-only SSE decoder: incrementally bounded, strict UTF-8, no full-stream buffering. */
const MAX_FRAME_BYTES = MODEL_STREAM_MAX_DELTA_FRAME_BYTES;
// Responses terminal snapshots repeat text/content/item output as JSON.
// Bound those frames by the total budget rather than the delta-frame budget.
const MAX_COMPLETED_FRAME_BYTES = MODEL_STREAM_MAX_BYTES;
const MAX_TEXT_BYTES = MODEL_STREAM_MAX_TEXT_BYTES;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | null {
	return isRecord(value) ? value : null;
}

function usage(raw: unknown, input: string, output: string): ModelStreamEvent | null {
	if (raw === undefined || raw === null) {
		return null;
	}
	const obj = record(raw);
	if (
		!obj ||
		typeof obj[input] !== 'number' ||
		typeof obj[output] !== 'number' ||
		!Number.isSafeInteger(obj[input]) ||
		!Number.isSafeInteger(obj[output]) ||
		obj[input] < 0 ||
		obj[output] < 0
	) {
		throw new ModelNetworkFailure('response_invalid');
	}
	return { type: 'usage', inputTokens: obj[input], outputTokens: obj[output] };
}

function textFromResponse(raw: Record<string, unknown>, tools: ModelToolStream): string {
	if (!Array.isArray(raw.output)) {
		throw new ModelNetworkFailure('response_invalid');
	}
	const chunks: string[] = [];
	let textBytes = 0;
	for (const [index, item] of raw.output.entries()) {
		const obj = record(item);
		if (obj?.type === 'function_call') {
			tools.responseSnapshot(index, obj);
			continue;
		}
		if (!obj || (obj.type !== 'message' && obj.type !== 'reasoning')) {
			throw new ModelNetworkFailure('response_invalid');
		}
		if (obj.type === 'reasoning') {
			continue;
		}
		if (obj.role !== 'assistant') {
			throw new ModelNetworkFailure('response_invalid');
		}
		if (!Array.isArray(obj.content)) {
			throw new ModelNetworkFailure('response_invalid');
		}
		for (const part of obj.content) {
			const p = record(part);
			if (p?.type !== 'output_text' || typeof p.text !== 'string') {
				throw new ModelNetworkFailure('response_invalid');
			}
			textBytes += Buffer.byteLength(p.text, 'utf8');
			if (textBytes > MAX_TEXT_BYTES) {
				throw new ModelNetworkFailure('too_large');
			}
			chunks.push(p.text);
		}
	}
	return chunks.join('');
}

export class ModelStreamDecoder {
	private readonly utf8 = new TextDecoder('utf-8', { fatal: true });
	private buffer = '';
	private skipLeadingLineFeed = false;
	private textBytes = 0;
	private readonly responseChunks: string[] = [];
	private itemChunks: string[] = [];
	private hasVisibleText = false;
	private finished = false;
	private finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null = null;
	private readonly tools: ModelToolStream;
	private reasoning: ModelReasoningState[] = [];
	private done = false;
	private hasUsage = false;

	constructor(
		private readonly protocol: ModelStreamInput['protocol'],
		allowTools = false,
	) {
		this.tools = new ModelToolStream(allowTools);
	}

	private delta(value: unknown): ModelStreamEvent[] {
		if (typeof value !== 'string') {
			throw new ModelNetworkFailure('response_invalid');
		}
		this.textBytes += Buffer.byteLength(value, 'utf8');
		if (this.textBytes > MAX_TEXT_BYTES) {
			throw new ModelNetworkFailure('too_large');
		}
		if (value.trim()) {
			this.hasVisibleText = true;
		}
		if (this.protocol === 'responses' && value) {
			this.responseChunks.push(value);
			this.itemChunks.push(value);
		}
		return value ? [{ type: 'text_delta', text: value }] : [];
	}

	private frame(frame: string): ModelStreamEvent[] {
		const frameBytes = Buffer.byteLength(frame, 'utf8');
		const lines = frame.split(/\r\n|\r|\n/);
		// SSE event names are part of the provider protocol, not harmless
		// decoration. A named error or a mismatched Responses event must never
		// be interpreted as a successful text delta or ignored metadata.
		let eventName: string | undefined;
		for (const line of lines) {
			if (line.startsWith('event:')) {
				if (eventName !== undefined) {
					throw new ModelNetworkFailure('response_invalid');
				}
				eventName = line.slice(6).trim();
				if (!eventName) {
					throw new ModelNetworkFailure('response_invalid');
				}
			}
		}
		const data = lines
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).trimStart())
			.join('\n');
		if (!data) {
			if (frameBytes > MAX_FRAME_BYTES) {
				throw new ModelNetworkFailure('too_large');
			}
			if (eventName !== undefined) {
				throw new ModelNetworkFailure('response_invalid');
			}
			return [];
		}
		if (this.protocol === 'chat-completions' && eventName !== undefined && eventName !== 'message') {
			throw new ModelNetworkFailure('response_invalid');
		}
		if (data === '[DONE]') {
			if (frameBytes > MAX_FRAME_BYTES) {
				throw new ModelNetworkFailure('too_large');
			}
			if (this.protocol !== 'chat-completions' || !this.finished || this.done) {
				throw new ModelNetworkFailure('response_invalid');
			}
			this.done = true;
			return [];
		}
		if (this.done || (this.finished && this.protocol === 'responses')) {
			throw new ModelNetworkFailure('response_invalid');
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch {
			throw new ModelNetworkFailure('response_invalid');
		}
		const event = record(parsed);
		if (!event) {
			throw new ModelNetworkFailure('response_invalid');
		}
		if (this.protocol === 'responses' && eventName !== undefined && eventName !== event.type) {
			throw new ModelNetworkFailure('response_invalid');
		}
		const isOutputSnapshot =
			this.protocol === 'responses' &&
			(event.type === 'response.completed' ||
				event.type === 'response.output_text.done' ||
				event.type === 'response.content_part.done' ||
				event.type === 'response.output_item.done' ||
				event.type === 'response.function_call_arguments.done');
		if (frameBytes > MAX_FRAME_BYTES && !isOutputSnapshot) {
			throw new ModelNetworkFailure('too_large');
		}
		if (this.protocol === 'responses') {
			if (
				(event.error !== undefined && event.error !== null) ||
				(event.incomplete_details !== undefined && event.incomplete_details !== null)
			) {
				throw new ModelNetworkFailure('response_invalid');
			}
			if (
				event.type === 'response.function_call_arguments.delta' ||
				event.type === 'response.function_call_arguments.done'
			) {
				this.tools.response(event);
				return [];
			}
			if (event.type === 'response.output_text.delta') {
				return this.delta(event.delta);
			}
			if (event.type === 'response.output_text.done') {
				if (typeof event.text !== 'string') {
					throw new ModelNetworkFailure('response_invalid');
				}
				const itemText = this.itemChunks.join('');
				if (itemText && itemText !== event.text) {
					throw new ModelNetworkFailure('response_invalid');
				}
				const output = itemText ? [] : this.delta(event.text);
				this.itemChunks = [];
				return output;
			}
			if (event.type === 'response.completed') {
				const response = record(event.response);
				if (
					!response ||
					response.status !== 'completed' ||
					(response.error !== undefined && response.error !== null) ||
					(response.incomplete_details !== undefined && response.incomplete_details !== null)
				) {
					throw new ModelNetworkFailure('response_invalid');
				}
				const full = textFromResponse(response, this.tools);
				const calls = this.tools.finish();
				if (
					!Array.isArray(response.output) ||
					response.output.filter((item: unknown) => record(item)?.type === 'function_call').length !==
						calls.length
				) {
					throw new ModelNetworkFailure('response_invalid');
				}
				if (calls.length > 0) {
					this.reasoning = responseReasoning(response.output);
				}
				const outputs = full && this.textBytes === 0 ? this.delta(full) : [];
				if (this.responseChunks.join('') !== full) {
					throw new ModelNetworkFailure('response_invalid');
				}
				const reported = usage(response.usage, 'input_tokens', 'output_tokens');
				this.finished = true;
				this.finishReason = calls.length === 0 ? 'stop' : 'tool_calls';
				return [...outputs, ...(reported ? [reported] : [])];
			}
			if (event.type === 'response.failed' || event.type === 'response.incomplete' || event.type === 'error') {
				throw new ModelNetworkFailure('response_invalid');
			}
			if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
				const item = record(event.item);
				if (item?.type === 'function_call') {
					if (event.type === 'response.output_item.added') {
						this.tools.response(event);
					} else {
						if (typeof event.output_index !== 'number') {
							throw new ModelNetworkFailure('response_invalid');
						}
						this.tools.responseSnapshot(event.output_index, item);
					}
					return [];
				}
				if (!item || (item.type !== 'message' && item.type !== 'reasoning')) {
					throw new ModelNetworkFailure('response_invalid');
				}
				if (item.type === 'message' && item.role !== 'assistant') {
					throw new ModelNetworkFailure('response_invalid');
				}
				return [];
			}
			if (event.type === 'response.content_part.added' || event.type === 'response.content_part.done') {
				const part = record(event.part);
				if (!part || part.type !== 'output_text') {
					throw new ModelNetworkFailure('response_invalid');
				}
				return [];
			}
			if (
				event.type !== 'response.created' &&
				event.type !== 'response.in_progress' &&
				event.type !== 'response.reasoning_summary_text.delta' &&
				event.type !== 'response.reasoning_summary_text.done' &&
				event.type !== 'response.reasoning_summary_part.added' &&
				event.type !== 'response.reasoning_summary_part.done'
			) {
				// Refusal and unrecognized vendor output are never a silent success.
				throw new ModelNetworkFailure('response_invalid');
			}
			return [];
		}
		if (event.error !== undefined) {
			throw new ModelNetworkFailure('response_invalid');
		}
		if (
			(event.type !== undefined && event.type !== 'chat.completion.chunk') ||
			(event.object !== undefined && event.object !== 'chat.completion.chunk') ||
			'message' in event ||
			'tool_calls' in event ||
			'function_call' in event ||
			'refusal' in event
		) {
			// A success-shaped choices array cannot override an explicit error,
			// tool, refusal, or non-streaming message in the outer envelope.
			throw new ModelNetworkFailure('response_invalid');
		}
		if (!Array.isArray(event.choices)) {
			throw new ModelNetworkFailure('response_invalid');
		}
		if (event.choices.length > 1 || (this.finished && event.choices.length > 0)) {
			throw new ModelNetworkFailure('response_invalid');
		}
		const result: ModelStreamEvent[] = [];
		for (const item of event.choices) {
			const choice = record(item);
			if (
				!choice ||
				choice.index !== 0 ||
				choice.delta === null ||
				Object.keys(choice).some(
					(key) => key !== 'index' && key !== 'delta' && key !== 'finish_reason' && key !== 'logprobs',
				) ||
				(choice.finish_reason !== null &&
					choice.finish_reason !== undefined &&
					choice.finish_reason !== 'stop' &&
					choice.finish_reason !== 'length' &&
					choice.finish_reason !== 'content_filter' &&
					choice.finish_reason !== 'tool_calls')
			) {
				throw new ModelNetworkFailure('response_invalid');
			}
			const delta = record(choice.delta);
			if (
				!delta ||
				Object.keys(delta).some((key) => key !== 'role' && key !== 'content' && key !== 'tool_calls') ||
				(delta.role !== undefined && delta.role !== 'assistant')
			) {
				// Refusals, audio and unknown output must not be silently discarded.
				throw new ModelNetworkFailure('response_invalid');
			}
			if (delta.tool_calls !== undefined) {
				this.tools.chat(delta.tool_calls);
			}
			if (delta?.content !== undefined && delta.content !== null) {
				if (this.finished) {
					throw new ModelNetworkFailure('response_invalid');
				}
				result.push(...this.delta(delta.content));
			}
			if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
				if (this.finished) {
					throw new ModelNetworkFailure('response_invalid');
				}
				this.finished = true;
				this.finishReason = choice.finish_reason;
			}
		}
		const reported = usage(event.usage, 'prompt_tokens', 'completion_tokens');
		if (reported) {
			if (this.hasUsage) {
				throw new ModelNetworkFailure('response_invalid');
			}
			this.hasUsage = true;
			result.push(reported);
		}
		return result;
	}

	*feed(bytes: Uint8Array): IterableIterator<ModelStreamEvent> {
		let decoded: string;
		try {
			decoded = this.utf8.decode(bytes, { stream: true });
		} catch {
			throw new ModelNetworkFailure('response_invalid');
		}
		// Normalize complete line endings before framing. A CRLF is ONE line
		// ending, including when the pair is split across reader chunks.
		if (decoded.length) {
			if (this.skipLeadingLineFeed && decoded.startsWith('\n')) {
				decoded = decoded.slice(1);
			}
			this.skipLeadingLineFeed = decoded.endsWith('\r');
		}
		this.buffer += decoded.replace(/\r\n|\r/g, '\n');
		for (;;) {
			const boundary = this.buffer.indexOf('\n\n');
			if (boundary === -1) {
				break;
			}
			const frame = this.buffer.slice(0, boundary);
			if (Buffer.byteLength(frame, 'utf8') > MAX_COMPLETED_FRAME_BYTES) {
				throw new ModelNetworkFailure('too_large');
			}
			this.buffer = this.buffer.slice(boundary + 2);
			// Yield each frame before decoding the next: a single read can contain
			// many SSE events, but the consumer controls incremental delivery.
			yield* this.frame(frame);
		}
		if (Buffer.byteLength(this.buffer, 'utf8') > MAX_COMPLETED_FRAME_BYTES) {
			throw new ModelNetworkFailure('too_large');
		}
	}

	finish(): ModelStreamEvent {
		try {
			this.buffer += this.utf8.decode();
		} catch {
			throw new ModelNetworkFailure('response_invalid');
		}
		if (this.buffer.trim()) {
			throw new ModelNetworkFailure('stream_truncated');
		}
		if (!this.finished || (this.protocol === 'chat-completions' && !this.done)) {
			throw new ModelNetworkFailure('stream_truncated');
		}
		const calls = this.tools.finish();
		if (this.finishReason === 'tool_calls') {
			if (calls.length === 0) {
				throw new ModelNetworkFailure('response_invalid');
			}
			return { type: 'completed', finishReason: 'tool_calls', toolCalls: calls, reasoning: this.reasoning };
		}
		if (calls.length !== 0) {
			throw new ModelNetworkFailure('response_invalid');
		}
		if (!this.hasVisibleText) {
			throw new ModelNetworkFailure('response_empty');
		}
		if (this.finishReason === null) {
			throw new ModelNetworkFailure('stream_truncated');
		}
		return { type: 'completed', finishReason: this.finishReason };
	}
}
