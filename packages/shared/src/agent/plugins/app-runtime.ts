import { AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES } from './values.js';
import * as z from 'zod/mini';
import { AGENT_REASONING_EFFORTS } from '../providers/values.js';
import { AGENT_ID_PATTERN } from '../values.js';
import { InvalidAgentPayload, agentRecord, agentInteger, readAgentId } from '../http-codec.js';
import { readAgentPluginContentReference } from './content.js';
import type { AgentPluginContentReference } from './content.js';

const id = z.string().check(z.regex(AGENT_ID_PATTERN));

const nonempty = z.string().check(z.minLength(1));

const reasoning = z.strictObject({ id: z.string(), encryptedContent: z.string(), summary: z.array(z.string()) });

const toolCall = z.strictObject({ id: nonempty, name: nonempty, argumentsJson: z.string() });

const imageReference = z.strictObject({
	type: z.literal('image'),
	artifactId: id,
	version: z.int().check(z.gte(1)),
	sha256: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
});

const userContent = z.union([
	z.string(),
	z
		.array(
			z.discriminatedUnion('type', [
				z.strictObject({ type: z.literal('text'), text: z.string() }),
				imageReference,
			]),
		)
		.check(z.minLength(1)),
]);

export const agentPluginModelMessageSchema = z.discriminatedUnion('role', [
	z.strictObject({ role: z.literal('user'), content: userContent }),
	z.strictObject({
		role: z.literal('assistant'),
		content: z.string(),
		toolCalls: z.array(toolCall),
		reasoning: z.array(reasoning),
	}),
	z.strictObject({ role: z.literal('tool'), callId: nonempty, content: z.string() }),
]);

export type AgentPluginModelMessage = z.infer<typeof agentPluginModelMessageSchema>;

export const agentPluginModelBodySchema = z.strictObject({
	text: z.string(),
	finishReason: z.enum(['stop', 'tool_calls']),
	toolCalls: z.array(z.strictObject({ id: nonempty, name: nonempty, bindingId: id, argumentsJson: z.string() })),
	reasoning: z.array(reasoning),
});

export type AgentPluginModelBody = z.infer<typeof agentPluginModelBodySchema>;

export interface AgentPluginModelSelection {
	providerId: string;
	modelId: string;
	configurationVersion: number;
	reasoningEffort: (typeof AGENT_REASONING_EFFORTS)[number] | null;
}

export interface AgentPluginModelDescriptor {
	protocol: 'responses' | 'chat-completions' | 'images';
	contextWindow: number | null;
	maxOutputTokens: number | null;
	supportsTools: boolean;
	supportsImageInput: boolean;
	reasoningEfforts: (typeof AGENT_REASONING_EFFORTS)[number][];
	chosenReasoningEffort: (typeof AGENT_REASONING_EFFORTS)[number] | null;
}

export interface AgentPluginModelRequest {
	operationKey: string;
	model: AgentPluginModelSelection;
	systemPrompt: string;
	messages: AgentPluginContentReference;
	tools: { name: string; bindingId: string }[];
	maxOutputTokens: number;
	/** UI presentation is separate from the model request and never an authorization claim. */
	visible: boolean;
}

export interface AgentPluginModelResponse {
	operationId: string;
	body: AgentPluginContentReference;
	inputTokens: number | null;
	outputTokens: number | null;
}

export function readAgentPluginModelSelection(input: unknown): AgentPluginModelSelection {
	const row = agentRecord(
		input,
		['providerId', 'modelId', 'configurationVersion', 'reasoningEffort'],
		AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
	);
	const effort =
		row.reasoningEffort === null ? null : AGENT_REASONING_EFFORTS.find((value) => value === row.reasoningEffort);
	if (typeof row.modelId !== 'string' || !row.modelId || row.modelId.includes('\0') || effort === undefined) {
		throw new InvalidAgentPayload();
	}
	return {
		providerId: readAgentId(row.providerId),
		modelId: row.modelId,
		configurationVersion: agentInteger(row.configurationVersion, 1),
		reasoningEffort: effort,
	};
}

export function readAgentPluginModelDescriptor(input: unknown): AgentPluginModelDescriptor {
	const row = agentRecord(
		input,
		[
			'protocol',
			'contextWindow',
			'maxOutputTokens',
			'supportsTools',
			'supportsImageInput',
			'reasoningEfforts',
			'chosenReasoningEffort',
		],
		AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
	);
	const effort =
		row.chosenReasoningEffort === null
			? null
			: AGENT_REASONING_EFFORTS.find((value) => value === row.chosenReasoningEffort);
	if (
		(row.protocol !== 'responses' && row.protocol !== 'chat-completions' && row.protocol !== 'images') ||
		typeof row.supportsTools !== 'boolean' ||
		typeof row.supportsImageInput !== 'boolean' ||
		!Array.isArray(row.reasoningEfforts) ||
		effort === undefined
	) {
		throw new InvalidAgentPayload();
	}
	const reasoningEfforts = row.reasoningEfforts.map((item) => {
		const value = AGENT_REASONING_EFFORTS.find((value) => value === item);
		if (value === undefined) {
			throw new InvalidAgentPayload();
		}
		return value;
	});
	if (
		new Set(reasoningEfforts).size !== reasoningEfforts.length ||
		(effort !== null && !reasoningEfforts.includes(effort))
	) {
		throw new InvalidAgentPayload();
	}
	return {
		protocol: row.protocol,
		contextWindow: row.contextWindow === null ? null : agentInteger(row.contextWindow, 1),
		maxOutputTokens: row.maxOutputTokens === null ? null : agentInteger(row.maxOutputTokens, 1),
		supportsTools: row.supportsTools,
		supportsImageInput: row.supportsImageInput,
		reasoningEfforts,
		chosenReasoningEffort: effort,
	};
}

export function readAgentPluginModelRequest(input: unknown): AgentPluginModelRequest {
	const row = agentRecord(
		input,
		['operationKey', 'model', 'systemPrompt', 'messages', 'tools', 'maxOutputTokens', 'visible'],
		AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
	);
	const model = agentRecord(
		row.model,
		['providerId', 'modelId', 'configurationVersion', 'reasoningEffort'],
		AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
	);
	const effort =
		model.reasoningEffort === null
			? null
			: AGENT_REASONING_EFFORTS.find((value) => value === model.reasoningEffort);
	if (
		typeof row.operationKey !== 'string' ||
		!row.operationKey ||
		typeof row.systemPrompt !== 'string' ||
		typeof model.modelId !== 'string' ||
		!model.modelId ||
		effort === undefined ||
		!Array.isArray(row.tools) ||
		typeof row.visible !== 'boolean'
	) {
		throw new InvalidAgentPayload();
	}
	const tools = row.tools.map((input) => {
		const tool = agentRecord(input, ['name', 'bindingId'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
		if (typeof tool.name !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(tool.name)) {
			throw new InvalidAgentPayload();
		}
		return { name: tool.name, bindingId: readAgentId(tool.bindingId) };
	});
	if (
		new Set(tools.map((tool) => tool.name)).size !== tools.length ||
		new Set(tools.map((tool) => tool.bindingId)).size !== tools.length
	) {
		throw new InvalidAgentPayload();
	}
	return {
		operationKey: row.operationKey,
		model: {
			providerId: readAgentId(model.providerId),
			modelId: model.modelId,
			configurationVersion: agentInteger(model.configurationVersion, 1),
			reasoningEffort: effort,
		},
		systemPrompt: row.systemPrompt,
		messages: readAgentPluginContentReference(row.messages),
		tools,
		maxOutputTokens: agentInteger(row.maxOutputTokens, 1),
		visible: row.visible,
	};
}

export function readAgentPluginModelResponse(input: unknown): AgentPluginModelResponse {
	const row = agentRecord(
		input,
		['operationId', 'body', 'inputTokens', 'outputTokens'],
		AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
	);
	const inputTokens = row.inputTokens === null ? null : agentInteger(row.inputTokens);
	const outputTokens = row.outputTokens === null ? null : agentInteger(row.outputTokens);
	if ((inputTokens === null) !== (outputTokens === null)) {
		throw new InvalidAgentPayload();
	}
	return {
		operationId: readAgentId(row.operationId),
		body: readAgentPluginContentReference(row.body),
		inputTokens,
		outputTokens,
	};
}

export function readAgentPluginModelMessages(input: unknown): AgentPluginModelMessage[] {
	const result = z.safeParse(z.array(agentPluginModelMessageSchema), input);
	if (!result.success) {
		throw new InvalidAgentPayload();
	}
	return result.data.map((message) =>
		message.role === 'user'
			? {
					role: 'user',
					content:
						typeof message.content === 'string'
							? message.content
							: message.content.map((part) =>
									part.type === 'text'
										? { type: 'text', text: part.text }
										: {
												type: 'image',
												artifactId: part.artifactId,
												version: part.version,
												sha256: part.sha256,
											},
								),
				}
			: message.role === 'tool'
				? { role: 'tool', callId: message.callId, content: message.content }
				: {
						role: 'assistant',
						content: message.content,
						toolCalls: message.toolCalls.map((call) => ({
							id: call.id,
							name: call.name,
							argumentsJson: call.argumentsJson,
						})),
						reasoning: message.reasoning.map((item) => ({
							id: item.id,
							encryptedContent: item.encryptedContent,
							summary: item.summary.map((text) => text),
						})),
					},
	);
}

export function readAgentPluginModelBody(input: unknown): AgentPluginModelBody {
	const result = z.safeParse(agentPluginModelBodySchema, input);
	if (
		!result.success ||
		(result.data.finishReason === 'tool_calls') !== result.data.toolCalls.length > 0 ||
		new Set(result.data.toolCalls.map((call) => call.id)).size !== result.data.toolCalls.length
	) {
		throw new InvalidAgentPayload();
	}
	return {
		text: result.data.text,
		finishReason: result.data.finishReason,
		toolCalls: result.data.toolCalls.map((call) => ({
			id: call.id,
			name: call.name,
			bindingId: call.bindingId,
			argumentsJson: call.argumentsJson,
		})),
		reasoning: result.data.reasoning.map((item) => ({
			id: item.id,
			encryptedContent: item.encryptedContent,
			summary: item.summary.map((text) => text),
		})),
	};
}
