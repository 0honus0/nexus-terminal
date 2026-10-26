import type { RunModelMessage } from '../runs/model/run-types.js';
import type { ToolDefinition } from '../tools/model/tool-types.js';

/** OpenCode 49a112f: deliberately approximate, never a provider tokenizer. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export function estimateMessages(messages: RunModelMessage[]): number {
	return messages.reduce((total, message) => total + estimateTokens(JSON.stringify(message)) + 4, 0);
}

export function estimateTools(definitions: ToolDefinition[]): number {
	return estimateTokens(JSON.stringify(definitions));
}

export function compactionCeiling(window: number | undefined): number {
	if (window === undefined) {
		return Infinity;
	}
	return window - Math.max(Math.floor(window * 0.15), window >= 32000 ? 16000 : 0);
}

/** Keep a recent suffix, cutting only between user turns or complete assistant/tool groups. */
export function compactionCut(messages: RunModelMessage[], window: number): number | null {
	const keep = Math.min(Math.max(30000, Math.floor(window * 0.25)), Math.floor(window * 0.5));
	let tokens = 0;
	let boundary = messages.length;
	for (let index = messages.length - 1; index >= 0; index--) {
		tokens += estimateMessages([messages[index]]);
		if (messages[index].role !== 'tool') {
			boundary = index;
			if (tokens >= keep) {
				break;
			}
		}
	}
	// Always retain the latest full interaction, even when it alone exceeds keep.
	if (boundary === messages.length) {
		return null;
	}
	return boundary > 0 ? boundary : null;
}
