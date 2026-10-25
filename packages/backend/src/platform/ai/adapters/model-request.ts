import type {
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type { ResponseCreateParamsStreaming, ResponseInputItem } from 'openai/resources/responses/responses';
import {
	ModelNetworkFailure,
	MODEL_STREAM_MAX_BYTES,
	MODEL_TOOL_MAX_CALLS,
	MODEL_TOOL_MAX_DEFINITIONS,
	MODEL_TOOL_MAX_ARGUMENT_BYTES,
	MODEL_REASONING_MAX_BYTES,
} from '../model-port.js';
import type { ModelStreamInput, ModelMessage, ModelToolDefinition, ModelToolProperty } from '../model-port.js';

function parameters(input: ModelToolDefinition['parameters']): ModelToolDefinition['parameters'] {
	const fields = Object.entries(input.properties);
	if (
		input.type !== 'object' ||
		input.additionalProperties !== false ||
		fields.length > 32 ||
		new Set(input.required).size !== input.required.length ||
		input.required.some((name) => !(name in input.properties))
	) {
		throw new ModelNetworkFailure('response_invalid');
	}
	const properties: Record<string, ModelToolProperty> = {};
	for (const [name, field] of fields) {
		if (!/^[a-zA-Z0-9_]{1,64}$/u.test(name)) {
			throw new ModelNetworkFailure('response_invalid');
		}
		if (field.type === 'array') {
			if (
				!Number.isSafeInteger(field.minItems) ||
				!Number.isSafeInteger(field.maxItems) ||
				field.minItems < 1 ||
				field.maxItems < field.minItems ||
				field.maxItems > 128 ||
				field.items.type !== 'string' ||
				!Number.isSafeInteger(field.items.minLength) ||
				!Number.isSafeInteger(field.items.maxLength) ||
				field.items.minLength < 0 ||
				field.items.minLength > field.items.maxLength ||
				field.items.maxLength > MODEL_TOOL_MAX_ARGUMENT_BYTES
			) {
				throw new ModelNetworkFailure('response_invalid');
			}
			properties[name] = {
				type: 'array',
				minItems: field.minItems,
				maxItems: field.maxItems,
				items: { type: 'string', minLength: field.items.minLength, maxLength: field.items.maxLength },
			};
		} else if (field.type === 'integer') {
			if (
				!Number.isSafeInteger(field.minimum) ||
				!Number.isSafeInteger(field.maximum) ||
				field.minimum > field.maximum
			) {
				throw new ModelNetworkFailure('response_invalid');
			}
			properties[name] = { type: 'integer', minimum: field.minimum, maximum: field.maximum };
		} else {
			if (
				field.type !== 'string' ||
				!Number.isSafeInteger(field.minLength) ||
				!Number.isSafeInteger(field.maxLength) ||
				field.minLength < 0 ||
				field.minLength > field.maxLength
			) {
				throw new ModelNetworkFailure('response_invalid');
			}
			properties[name] = { type: 'string', minLength: field.minLength, maxLength: field.maxLength };
		}
	}
	return { type: 'object', properties, required: input.required.map((name) => name), additionalProperties: false };
}

function chatMessage(value: ModelMessage): ChatCompletionMessageParam {
	if (value.role === 'user') {
		return { role: 'user', content: value.content };
	}
	if (value.role === 'tool') {
		return { role: 'tool', tool_call_id: value.callId, content: value.content };
	}
	return {
		role: 'assistant',
		content: value.content || null,
		...(value.toolCalls.length === 0
			? {}
			: {
					tool_calls: value.toolCalls.map((call) => ({
						id: call.id,
						type: 'function',
						function: { name: call.name, arguments: call.argumentsJson },
					})),
				}),
	};
}

function responseMessages(value: ModelMessage): ResponseInputItem[] {
	if (value.role === 'user') {
		return [{ role: 'user', content: value.content }];
	}
	if (value.role === 'tool') {
		return [{ type: 'function_call_output', call_id: value.callId, output: value.content }];
	}
	return [
		...value.reasoning.map((item) => ({
			type: 'reasoning' as const,
			id: item.id,
			encrypted_content: item.encryptedContent,
			summary: item.summary.map((text) => ({ type: 'summary_text' as const, text })),
		})),
		...(value.content ? [{ role: 'assistant' as const, content: value.content }] : []),
		...value.toolCalls.map((call) => ({
			type: 'function_call' as const,
			call_id: call.id,
			name: call.name,
			arguments: call.argumentsJson,
		})),
	];
}

function validateHistory(input: ModelStreamInput): void {
	const pending = new Set<string>();
	const names = new Set(input.tools.map((tool) => tool.name));
	let bytes = 0;
	for (const message of input.messages) {
		bytes += Buffer.byteLength(JSON.stringify(message), 'utf8');
		if (bytes > MODEL_STREAM_MAX_BYTES) {
			throw new ModelNetworkFailure('too_large');
		}
		if (message.role === 'tool') {
			if (!pending.delete(message.callId)) {
				throw new ModelNetworkFailure('response_invalid');
			}
			continue;
		}
		if (pending.size) {
			throw new ModelNetworkFailure('response_invalid');
		}
		if (message.role === 'user') {
			continue;
		}
		if (
			(!message.content.trim() && message.toolCalls.length === 0) ||
			message.toolCalls.length > MODEL_TOOL_MAX_CALLS ||
			(input.protocol !== 'responses' && message.reasoning.length > 0) ||
			Buffer.byteLength(JSON.stringify(message.reasoning), 'utf8') > MODEL_REASONING_MAX_BYTES
		) {
			throw new ModelNetworkFailure('response_invalid');
		}
		for (const call of message.toolCalls) {
			if (
				!call.id ||
				Buffer.byteLength(call.id, 'utf8') > 256 ||
				pending.has(call.id) ||
				!names.has(call.name) ||
				Buffer.byteLength(call.argumentsJson, 'utf8') > MODEL_TOOL_MAX_ARGUMENT_BYTES
			) {
				throw new ModelNetworkFailure('response_invalid');
			}
			pending.add(call.id);
		}
	}
	if (pending.size) {
		throw new ModelNetworkFailure('response_invalid');
	}
}

function toolDefinitions(input: ModelStreamInput) {
	if (
		input.messages.length === 0 ||
		input.messages.length > 1024 ||
		input.messages[0].role !== 'user' ||
		input.tools.length > MODEL_TOOL_MAX_DEFINITIONS ||
		new Set(input.tools.map((tool) => tool.name)).size !== input.tools.length ||
		!Number.isSafeInteger(input.maxOutputTokens) ||
		input.maxOutputTokens < 1
	) {
		throw new ModelNetworkFailure('response_invalid');
	}
	validateHistory(input);
	return input.tools.map((tool) => {
		if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(tool.name) || !tool.description.trim()) {
			throw new ModelNetworkFailure('response_invalid');
		}
		return {
			name: tool.name,
			description: tool.description,
			parameters: parameters(tool.parameters),
		};
	});
}

/** SDK request types remain inside the technical adapter. */
export function chatModelRequest(input: ModelStreamInput): ChatCompletionCreateParamsStreaming {
	const tools: NonNullable<ChatCompletionCreateParamsStreaming['tools']> = toolDefinitions(input).map((tool) => ({
		type: 'function',
		function: { name: tool.name, description: tool.description, parameters: tool.parameters },
	}));
	return {
		model: input.modelId,
		messages: input.messages.map(chatMessage),
		stream: true,
		stream_options: { include_usage: true },
		...(input.usesReasoning
			? { max_completion_tokens: input.maxOutputTokens }
			: { max_tokens: input.maxOutputTokens }),
		...(tools.length ? { tools } : {}),
		...(input.reasoningEffort === undefined ? {} : { reasoning_effort: input.reasoningEffort }),
	};
}

export function responseModelRequest(input: ModelStreamInput): ResponseCreateParamsStreaming {
	const tools: NonNullable<ResponseCreateParamsStreaming['tools']> = toolDefinitions(input).map((tool) => ({
		type: 'function',
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
		strict: false,
	}));
	return {
		model: input.modelId,
		input: input.messages.flatMap(responseMessages),
		max_output_tokens: input.maxOutputTokens,
		stream: true,
		store: false,
		include: ['reasoning.encrypted_content'],
		...(tools.length ? { tools } : {}),
		...(input.reasoningEffort === undefined ? {} : { reasoning: { effort: input.reasoningEffort } }),
	};
}
