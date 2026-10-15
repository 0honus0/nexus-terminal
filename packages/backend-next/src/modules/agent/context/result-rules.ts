import { createHash } from 'node:crypto';
import { AgentFailure } from '../agent-failure.js';
import { TOOL_RESULT_MAX_BYTES } from '../runs/run-tool-limits.js';
import type { ResultReadInput, ResultPage } from './model/context-types.js';

/** Private model representation budgets, independent of execution capture limits. */
export const RESULT_MODEL_MAX_BYTES = 8 * 1024;

export const RESULT_PAGE_MAX_BYTES = 4 * 1024;

export function capturedResultHash(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Offset is Unicode code points; maxBytes bounds the JSON-encoded text, including quotes. */
export function resultPage(text: string, input: ResultReadInput): ResultPage {
	if (
		!Number.isSafeInteger(input.offset) ||
		input.offset < 0 ||
		!Number.isSafeInteger(input.maxBytes) ||
		input.maxBytes < 8 ||
		input.maxBytes > RESULT_PAGE_MAX_BYTES ||
		Buffer.byteLength(text, 'utf8') > TOOL_RESULT_MAX_BYTES
	) {
		throw new AgentFailure('invalid_input');
	}
	if (capturedResultHash(text) !== input.sha256) {
		throw new AgentFailure('version_conflict');
	}
	let index = 0;
	let bytes = 2;
	const characters: string[] = [];
	let hasMore = false;
	for (const character of text) {
		if (index < input.offset) {
			index++;
			continue;
		}
		const cost = Buffer.byteLength(JSON.stringify(character), 'utf8') - 2;
		if (bytes + cost > input.maxBytes) {
			hasMore = true;
			break;
		}
		characters.push(character);
		bytes += cost;
		index++;
	}
	if (index < input.offset) {
		throw new AgentFailure('invalid_input');
	}
	return {
		toolCallId: input.toolCallId,
		sha256: input.sha256,
		originalBytes: Buffer.byteLength(text, 'utf8'),
		offset: input.offset,
		nextOffset: hasMore ? index : null,
		text: characters.join(''),
	};
}

/** The raw journal is unchanged. The model receives an explicit, recoverable preview. */
export function projectCapturedResult(id: string, text: string): string {
	if (Buffer.byteLength(text, 'utf8') <= RESULT_MODEL_MAX_BYTES) {
		return text;
	}
	return JSON.stringify({
		kind: 'captured_result_preview',
		truncated: true,
		projection: resultPage(text, {
			toolCallId: id,
			sha256: capturedResultHash(text),
			offset: 0,
			maxBytes: RESULT_PAGE_MAX_BYTES,
		}),
	});
}
