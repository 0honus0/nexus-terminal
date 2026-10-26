import { estimateMessages, estimateTools } from './compaction-rules.js';
import { AgentFailure, ContextLimitExceeded } from '../agent-failure.js';
import type { RunModelMessage } from '../runs/model/run-types.js';
import type { ToolDefinition } from '../tools/model/tool-types.js';
import type { ContextExchange, ContextLimits } from './model/context-types.js';
import { CONTEXT_MAX_BYTES } from './context-limits.js';

/** Approximation for reservation; observed provider usage supersedes it within a Run. */
export function estimateContextTokens(messages: RunModelMessage[], definitions: ToolDefinition[]): number {
	return estimateMessages(messages) + estimateTools(definitions);
}

export function copyContextMessage(message: RunModelMessage): RunModelMessage {
	if (message.role === 'user') {
		return { role: 'user', content: message.content };
	}
	if (message.role === 'tool') {
		return { role: 'tool', providerCallId: message.providerCallId, content: message.content };
	}
	return {
		role: 'assistant',
		content: message.content,
		proposals: message.proposals.map((proposal) => ({
			providerCallId: proposal.providerCallId,
			toolName: proposal.toolName,
			argumentsJson: proposal.argumentsJson,
		})),
		reasoning: message.reasoning.map((item) => ({
			id: item.id,
			encryptedContent: item.encryptedContent,
			summary: item.summary.map((text) => text),
		})),
	};
}

/** Never publish a partial tool group, including a missing or duplicate result. */
export function exchangeMessages(exchange: ContextExchange): RunModelMessage[] {
	const ids = new Set(exchange.proposals.map((proposal) => proposal.providerCallId));
	if (
		ids.size === 0 ||
		ids.size !== exchange.proposals.length ||
		exchange.results.length !== ids.size ||
		exchange.proposals.some((proposal) => !proposal.providerCallId.trim())
	) {
		throw new AgentFailure('invalid_input');
	}
	const results = new Map<string, string>();
	for (const result of exchange.results) {
		if (!ids.has(result.providerCallId) || results.has(result.providerCallId)) {
			throw new AgentFailure('invalid_input');
		}
		results.set(result.providerCallId, result.content);
	}
	const messages: RunModelMessage[] = [
		copyContextMessage({
			role: 'assistant',
			content: exchange.content,
			proposals: exchange.proposals,
			reasoning: exchange.reasoning,
		}),
	];
	for (const proposal of exchange.proposals) {
		const content = results.get(proposal.providerCallId);
		if (content === undefined) {
			throw new AgentFailure('invalid_input');
		}
		messages.push({ role: 'tool', providerCallId: proposal.providerCallId, content });
	}
	return messages;
}

export function contextBytes(messages: RunModelMessage[]): number {
	const bytes = Buffer.byteLength(JSON.stringify(messages), 'utf8');
	if (bytes > CONTEXT_MAX_BYTES) {
		throw new ContextLimitExceeded();
	}
	return bytes;
}

/** Validate request integrity and encoded capacity; provider tokenizers own model-window validation. */
export function validateContextBudget(
	messages: RunModelMessage[],
	definitions: ToolDefinition[],
	limits: ContextLimits,
): void {
	if (
		(limits.contextWindow !== undefined &&
			(!Number.isSafeInteger(limits.contextWindow) || limits.contextWindow < 1)) ||
		!Number.isSafeInteger(limits.reservedOutputTokens) ||
		limits.reservedOutputTokens < 1 ||
		new Set(definitions.map((tool) => tool.name)).size !== definitions.length
	) {
		throw new AgentFailure('invalid_input');
	}
	const names = new Set(definitions.map((tool) => tool.name));
	for (const message of messages) {
		if (message.role === 'assistant' && message.proposals.some((proposal) => !names.has(proposal.toolName))) {
			throw new AgentFailure('invalid_input');
		}
	}
	// Different providers use different tokenizers. Encoded bytes protect local
	// resources; they are not an authoritative model context-token count.
	const messageBytes = contextBytes(messages);
	const toolBytes = Buffer.byteLength(JSON.stringify(definitions), 'utf8');
	if (messageBytes + toolBytes > CONTEXT_MAX_BYTES) {
		throw new ContextLimitExceeded();
	}
}
