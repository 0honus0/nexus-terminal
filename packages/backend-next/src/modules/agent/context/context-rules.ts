import { AgentFailure } from '../agent-failure.js';
import type { RunModelMessage } from '../runs/model/run-types.js';
import type { ToolDefinition } from '../tools/model/tool-types.js';
import type { ContextExchange, ContextLimits } from './model/context-types.js';
import { CONTEXT_MAX_BYTES, CONTEXT_MAX_MESSAGES } from './context-limits.js';

const CONTEXT_FRAME_TOKENS = 64;
const CONTEXT_TOOL_FRAME_TOKENS = 512;
const CONTEXT_REQUEST_FRAME_TOKENS = 1024;

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
	if (messages.length > CONTEXT_MAX_MESSAGES || bytes > CONTEXT_MAX_BYTES) {
		throw new AgentFailure('limit_exceeded');
	}
	return bytes;
}

/** Include schemas and framing; never report this estimate as actual paid usage. */
export function validateContextBudget(
	messages: RunModelMessage[],
	definitions: ToolDefinition[],
	limits: ContextLimits,
): void {
	if (
		!Number.isSafeInteger(limits.contextWindow) ||
		!Number.isSafeInteger(limits.reservedOutputTokens) ||
		limits.reservedOutputTokens < 1 ||
		limits.contextWindow <= limits.reservedOutputTokens ||
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
	const messageBytes = contextBytes(messages);
	const toolBytes = Buffer.byteLength(JSON.stringify(definitions), 'utf8');
	if (messageBytes + toolBytes > CONTEXT_MAX_BYTES) {
		throw new AgentFailure('limit_exceeded');
	}
	// One unit per encoded UTF-8 byte deliberately favors rejection over silent
	// compaction. Provider-specific tokenization and usage anchoring are separate.
	const estimated =
		messageBytes +
		toolBytes +
		messages.length * CONTEXT_FRAME_TOKENS +
		definitions.length * CONTEXT_TOOL_FRAME_TOKENS +
		CONTEXT_REQUEST_FRAME_TOKENS;
	if (estimated + limits.reservedOutputTokens > limits.contextWindow) {
		throw new AgentFailure('limit_exceeded');
	}
}
