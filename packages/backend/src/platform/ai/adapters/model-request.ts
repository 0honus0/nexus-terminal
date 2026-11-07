import type {
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type { ResponseCreateParamsStreaming, ResponseInputItem } from 'openai/resources/responses/responses';
import {
	ModelNetworkFailure,
	MODEL_STREAM_MAX_BYTES,
	MODEL_TOOL_MAX_ARGUMENT_BYTES,
	MODEL_REASONING_MAX_BYTES,
} from '../model-port.js';
import type { ModelStreamInput, ModelMessage, ModelToolDefinition, ModelToolProperty } from '../model-port.js';
import { JsonSchemaValidator } from '../../validation/json-schema-validator.js';

function isSchemaObject(input: unknown): input is Record<string, unknown> {
	return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function schemaRecord(input: unknown, required: string[], optional: string[]): Record<string, unknown> {
	if (!isSchemaObject(input)) {
		throw new ModelNetworkFailure('response_invalid');
	}
	for (const key of Object.keys(input)) {
		if (!required.includes(key) && !optional.includes(key)) {
			throw new ModelNetworkFailure('response_invalid');
		}
	}
	if (required.some((key) => !Object.hasOwn(input, key))) {
		throw new ModelNetworkFailure('response_invalid');
	}
	return input;
}

function schemaText(input: unknown): string {
	if (typeof input !== 'string' || input.includes('\0')) {
		throw new ModelNetworkFailure('response_invalid');
	}
	return input;
}

function schemaCount(input: unknown): number | undefined {
	if (input === undefined) {
		return undefined;
	}
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
		throw new ModelNetworkFailure('response_invalid');
	}
	return input;
}

function schemaNumber(input: unknown): number | undefined {
	if (input === undefined) {
		return undefined;
	}
	if (typeof input !== 'number' || !Number.isFinite(input)) {
		throw new ModelNetworkFailure('response_invalid');
	}
	return input;
}

function validateBounds(minimum: number | undefined, maximum: number | undefined): void {
	if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
		throw new ModelNetworkFailure('response_invalid');
	}
}

function copySchemaDescription(input: Record<string, unknown>, result: { description?: string }): void {
	if (Object.hasOwn(input, 'description')) {
		result.description = schemaText(input.description);
	}
}

/** Decode and project the entire supported schema before either SDK receives it. */
function schemaProperty(input: unknown): ModelToolProperty {
	if (!isSchemaObject(input)) {
		throw new ModelNetworkFailure('response_invalid');
	}
	const type = input.type;
	if (type === 'object') {
		const row = schemaRecord(input, ['type', 'properties', 'required', 'additionalProperties'], ['description']);
		if (
			typeof row.properties !== 'object' ||
			row.properties === null ||
			Array.isArray(row.properties) ||
			!Array.isArray(row.required) ||
			row.additionalProperties !== false
		) {
			throw new ModelNetworkFailure('response_invalid');
		}
		const properties: Record<string, ModelToolProperty> = {};
		for (const [name, property] of Object.entries(row.properties)) {
			schemaText(name);
			Object.defineProperty(properties, name, {
				value: schemaProperty(property),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		const required = row.required.map(schemaText);
		if (new Set(required).size !== required.length || required.some((name) => !Object.hasOwn(properties, name))) {
			throw new ModelNetworkFailure('response_invalid');
		}
		const result: Extract<ModelToolProperty, { type: 'object' }> = {
			type: 'object',
			properties,
			required,
			additionalProperties: false,
		};
		copySchemaDescription(row, result);
		return result;
	}
	if (type === 'array') {
		const row = schemaRecord(input, ['type', 'items'], ['description', 'minItems', 'maxItems']);
		const minItems = schemaCount(row.minItems);
		const maxItems = schemaCount(row.maxItems);
		validateBounds(minItems, maxItems);
		const result: ModelToolProperty = { type: 'array', items: schemaProperty(row.items) };
		copySchemaDescription(row, result);
		if (minItems !== undefined) {
			result.minItems = minItems;
		}
		if (maxItems !== undefined) {
			result.maxItems = maxItems;
		}
		return result;
	}
	if (type === 'string') {
		const row = schemaRecord(input, ['type'], ['description', 'minLength', 'maxLength', 'enum']);
		const minLength = schemaCount(row.minLength);
		const maxLength = schemaCount(row.maxLength);
		validateBounds(minLength, maxLength);
		const result: ModelToolProperty = { type: 'string' };
		copySchemaDescription(row, result);
		if (minLength !== undefined) {
			result.minLength = minLength;
		}
		if (maxLength !== undefined) {
			result.maxLength = maxLength;
		}
		if (Object.hasOwn(row, 'enum')) {
			if (!Array.isArray(row.enum) || row.enum.length === 0) {
				throw new ModelNetworkFailure('response_invalid');
			}
			const values = row.enum.map(schemaText);
			if (new Set(values).size !== values.length) {
				throw new ModelNetworkFailure('response_invalid');
			}
			result.enum = values;
		}
		return result;
	}
	if (type === 'boolean') {
		const row = schemaRecord(input, ['type'], ['description']);
		const result: ModelToolProperty = { type: 'boolean' };
		copySchemaDescription(row, result);
		return result;
	}
	if (type === 'number' || type === 'integer') {
		const row = schemaRecord(input, ['type'], ['description', 'minimum', 'maximum']);
		const minimum = schemaNumber(row.minimum);
		const maximum = schemaNumber(row.maximum);
		validateBounds(minimum, maximum);
		const result: ModelToolProperty = { type };
		copySchemaDescription(row, result);
		if (minimum !== undefined) {
			result.minimum = minimum;
		}
		if (maximum !== undefined) {
			result.maximum = maximum;
		}
		return result;
	}
	throw new ModelNetworkFailure('response_invalid');
}

function parameters(input: ModelToolDefinition['parameters']): Record<string, unknown> {
	if ('schemaJson' in input) {
		try {
			// Preserve publisher-owned JSON Schema, including unions and references.
			// Compilation checks it without narrowing it to the old tool subset.
			new JsonSchemaValidator(input.schemaJson);
			const schema: unknown = JSON.parse(input.schemaJson);
			if (!isSchemaObject(schema)) {
				throw new ModelNetworkFailure('response_invalid');
			}
			return schema;
		} catch (error) {
			throw new ModelNetworkFailure('response_invalid', undefined, { cause: error, outcome: 'rejected' });
		}
	}
	const result = schemaProperty(input);
	if (result.type !== 'object') {
		throw new ModelNetworkFailure('response_invalid');
	}
	return result;
}

function chatMessage(value: ModelMessage): ChatCompletionMessageParam {
	if (value.role === 'user') {
		return {
			role: 'user',
			content:
				typeof value.content === 'string'
					? value.content
					: value.content.map((part) =>
							part.type === 'text'
								? { type: 'text', text: part.text }
								: {
										type: 'image_url',
										image_url: {
											url:
												'data:' +
												part.mediaType +
												';base64,' +
												Buffer.from(part.bytes).toString('base64'),
										},
									},
						),
		};
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
		return [
			{
				role: 'user',
				content:
					typeof value.content === 'string'
						? value.content
						: value.content.map((part) =>
								part.type === 'text'
									? { type: 'input_text', text: part.text }
									: {
											type: 'input_image',
											detail: 'auto',
											image_url:
												'data:' +
												part.mediaType +
												';base64,' +
												Buffer.from(part.bytes).toString('base64'),
										},
							),
			},
		];
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

/** Historical calls may outlive their availability; new proposals use the current Run catalog. */
function validateHistory(input: ModelStreamInput): void {
	const pending = new Set<string>();
	let bytes = 0;
	for (const message of input.messages) {
		// Count the actual base64 wire representation, rather than Uint8Array's numeric JSON object.
		bytes += Buffer.byteLength(
			JSON.stringify(input.protocol === 'responses' ? responseMessages(message) : chatMessage(message)),
			'utf8',
		);
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
				!/^[a-zA-Z0-9_-]{1,64}$/u.test(call.name) ||
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
		input.messages[0].role !== 'user' ||
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
		messages: [
			...(input.systemPrompt ? [{ role: 'system' as const, content: input.systemPrompt }] : []),
			...input.messages.map(chatMessage),
		],
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
		...(input.systemPrompt ? { instructions: input.systemPrompt } : {}),
		max_output_tokens: input.maxOutputTokens,
		stream: true,
		store: false,
		include: ['reasoning.encrypted_content'],
		...(tools.length ? { tools } : {}),
		...(input.reasoningEffort === undefined ? {} : { reasoning: { effort: input.reasoningEffort } }),
	};
}
