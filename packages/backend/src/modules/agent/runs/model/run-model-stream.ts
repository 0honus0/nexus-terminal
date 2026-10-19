import { AGENT_RUN_STEP_MAX_TEXT_BYTES } from '@nexus-terminal/shared/agent/runs/values';
import type { ModelNetworkPort } from '../../../../platform/ai/model-port.js';
import type { ModelMessage, ModelToolDefinition, ModelToolProperty } from '../../../../platform/ai/model-port.js';
import { createHash } from 'node:crypto';
import type { ToolDefinition } from '../../tools/model/tool-types.js';
import { toProviderRequestFailure } from '../../providers/model/provider-network-failure.js';
import { AgentFailure, ProviderRequestFailure } from '../../agent-failure.js';
import {
	TOOL_PROPOSAL_MAX_COUNT,
	TOOL_ARGUMENT_MAX_BYTES,
	TOOL_PROVIDER_CALL_ID_MAX_BYTES,
} from '../run-tool-limits.js';
import type { RunFrozenInput, RunModelDelta, RunModelMessage } from './run-types.js';

function toModelMessage(value: RunModelMessage): ModelMessage {
	if (value.role === 'user') {
		return { role: 'user', content: value.content };
	}
	if (value.role === 'tool') {
		return { role: 'tool', callId: value.providerCallId, content: value.content };
	}
	return {
		role: 'assistant',
		content: value.content,
		toolCalls: value.proposals.map((proposal) => ({
			id: proposal.providerCallId,
			name: proposal.toolName,
			argumentsJson: proposal.argumentsJson,
		})),
		reasoning: value.reasoning.map((item) => ({
			id: item.id,
			encryptedContent: item.encryptedContent,
			summary: item.summary.map((text) => text),
		})),
	};
}

function toModelTools(definitions: ToolDefinition[]): ModelToolDefinition[] {
	return definitions.map((tool) => {
		const properties: Record<string, ModelToolProperty> = {};
		for (const field of tool.input.fields) {
			properties[field.name] =
				field.kind === 'texts'
					? {
							type: 'array',
							minItems: 1,
							maxItems: field.maxItems,
							items: { type: 'string', minLength: 0, maxLength: field.maxItemBytes },
						}
					: field.kind === 'integer'
						? { type: 'integer', minimum: field.minimum, maximum: field.maximum }
						: { type: 'string', minLength: field.allowEmpty ? 0 : 1, maxLength: field.maxBytes };
		}
		return {
			name: tool.name,
			description: tool.description,
			parameters: {
				type: 'object',
				properties,
				required: tool.input.fields.filter((field) => field.required).map((field) => field.name),
				additionalProperties: false,
			},
		};
	});
}

export class RunModelStream {
	constructor(private readonly network: ModelNetworkPort) {}

	/** Each paid step has its own immutable request identity, distinct from Run creation. */
	requestHash(frozen: RunFrozenInput, messages: RunModelMessage[], definitions: ToolDefinition[]): string {
		return createHash('sha256')
			.update(
				JSON.stringify([
					1,
					frozen.providerId,
					frozen.providerVersion,
					frozen.credentialRevision,
					frozen.modelId,
					frozen.protocol,
					frozen.capabilities.maxOutputTokens,
					frozen.capabilities.defaultReasoningEffort ?? null,
					messages.map(toModelMessage),
					toModelTools(definitions),
				]),
			)
			.digest('hex');
	}

	/**
	 * Only the authorized Run executor may call this method. Neither a
	 * Provider probe nor a frozen model reference is itself execution approval.
	 * The Run owner must persist an attempt before dispatch and must not retry
	 * requests whose dispatch/result is unknown.
	 */
	async *stream(
		frozen: RunFrozenInput,
		messages: RunModelMessage[],
		definitions: ToolDefinition[],
		credential: string | null,
		signal: AbortSignal,
	): AsyncIterable<RunModelDelta> {
		if (frozen.executionPolicy !== 'governed') {
			throw new AgentFailure('provider_unavailable');
		}
		if (signal.aborted) {
			throw new ProviderRequestFailure('PROVIDER_NETWORK_TIMEOUT');
		}
		try {
			let completed = false;
			let hasUsage = false;
			let hasVisibleText = false;
			let textBytes = 0;
			let terminal: Extract<RunModelDelta, { kind: 'finished' }> | null = null;
			const events = this.network.stream(
				{
					baseUrl: frozen.baseUrl,
					protocol: frozen.protocol,
					modelId: frozen.modelId,
					credential,
					maxOutputTokens: frozen.capabilities.maxOutputTokens,
					usesReasoning: Boolean(frozen.capabilities.reasoningEfforts?.length),
					...(frozen.capabilities.defaultReasoningEffort === undefined
						? {}
						: { reasoningEffort: frozen.capabilities.defaultReasoningEffort }),
					messages: messages.map(toModelMessage),
					tools: toModelTools(definitions),
				},
				signal,
			);
			for await (const event of events) {
				if (signal.aborted) {
					throw new ProviderRequestFailure('PROVIDER_NETWORK_TIMEOUT');
				}
				if (completed) {
					throw new ProviderRequestFailure('PROVIDER_RESPONSE_INVALID');
				}
				if (event.type === 'text_delta') {
					if (typeof event.text !== 'string') {
						throw new ProviderRequestFailure('PROVIDER_RESPONSE_INVALID');
					}
					// Model→RunStep is a real boundary: the journal cannot persist
					// zero-byte deltas. A custom technical Port may emit empty
					// content even though the installed SSE Decoder filters it.
					if (event.text.length === 0) {
						continue;
					}
					textBytes += Buffer.byteLength(event.text, 'utf8');
					if (textBytes > AGENT_RUN_STEP_MAX_TEXT_BYTES) {
						throw new ProviderRequestFailure('PROVIDER_RESPONSE_TOO_LARGE');
					}
					if (event.text.trim()) {
						hasVisibleText = true;
					}
					yield { kind: 'text', content: event.text };
				} else if (event.type === 'usage') {
					if (
						hasUsage ||
						!Number.isSafeInteger(event.inputTokens) ||
						!Number.isSafeInteger(event.outputTokens) ||
						event.inputTokens < 0 ||
						event.outputTokens < 0
					) {
						throw new ProviderRequestFailure('PROVIDER_RESPONSE_INVALID');
					}
					hasUsage = true;
					yield { kind: 'usage', inputTokens: event.inputTokens, outputTokens: event.outputTokens };
				} else if (event.type === 'completed') {
					if (event.finishReason === 'tool_calls') {
						if (
							!event.toolCalls.length ||
							event.toolCalls.length > TOOL_PROPOSAL_MAX_COUNT ||
							new Set(event.toolCalls.map((call) => call.id)).size !== event.toolCalls.length ||
							event.toolCalls.some(
								(call) =>
									!call.id.trim() ||
									Buffer.byteLength(call.id, 'utf8') > TOOL_PROVIDER_CALL_ID_MAX_BYTES ||
									Buffer.byteLength(call.argumentsJson, 'utf8') > TOOL_ARGUMENT_MAX_BYTES ||
									!definitions.some((tool) => tool.name === call.name),
							)
						) {
							throw new ProviderRequestFailure('PROVIDER_RESPONSE_INVALID');
						}
						terminal = {
							kind: 'finished',
							finishReason: 'tool_calls',
							proposals: event.toolCalls.map((call) => ({
								providerCallId: call.id,
								toolName: call.name,
								argumentsJson: call.argumentsJson,
							})),
							reasoning: event.reasoning.map((item) => ({
								id: item.id,
								encryptedContent: item.encryptedContent,
								summary: item.summary.map((text) => text),
							})),
						};
					} else if (event.finishReason !== 'stop') {
						throw new ProviderRequestFailure(
							event.finishReason === 'length' ? 'PROVIDER_OUTPUT_TRUNCATED' : 'PROVIDER_CONTENT_FILTERED',
						);
					} else {
						terminal = { kind: 'finished', finishReason: 'stop' };
					}
					completed = true;
				} else {
					throw new ProviderRequestFailure('PROVIDER_RESPONSE_INVALID');
				}
			}
			// A transport's completed event is not sufficient. Its iterator must
			// also finish normally (including reader cleanup) before success can
			// reach the Run owner or be persisted as the authoritative terminal.
			if (signal.aborted) {
				throw new ProviderRequestFailure('PROVIDER_NETWORK_TIMEOUT');
			}
			if (!completed) {
				throw new ProviderRequestFailure('PROVIDER_STREAM_TRUNCATED');
			}
			if (!terminal) {
				throw new ProviderRequestFailure('PROVIDER_RESPONSE_INVALID');
			}
			if (terminal.finishReason === 'stop' && !hasVisibleText) {
				throw new ProviderRequestFailure('PROVIDER_RESPONSE_EMPTY');
			}
			yield terminal;
		} catch (error) {
			// SQL writes occur in the execution owner, outside this technical iterator.
			// Mapping a transport failure cannot trigger a retry of an unknown DB commit.
			throw toProviderRequestFailure(error);
		}
	}
}
