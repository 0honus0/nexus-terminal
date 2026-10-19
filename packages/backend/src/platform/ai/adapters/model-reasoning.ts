import { MODEL_REASONING_MAX_BYTES, ModelNetworkFailure } from '../model-port.js';
import type { ModelReasoningState } from '../model-port.js';

/** Stateless Responses continuations require the provider's encrypted reasoning evidence. */
export function responseReasoning(input: unknown[]): ModelReasoningState[] {
	const result: ModelReasoningState[] = [];
	let bytes = 0;
	for (const value of input) {
		if (
			!value ||
			typeof value !== 'object' ||
			Array.isArray(value) ||
			!('type' in value) ||
			value.type !== 'reasoning'
		) {
			continue;
		}
		if (
			!('id' in value) ||
			typeof value.id !== 'string' ||
			!value.id ||
			!('encrypted_content' in value) ||
			typeof value.encrypted_content !== 'string' ||
			!value.encrypted_content ||
			!('summary' in value) ||
			!Array.isArray(value.summary)
		) {
			throw new ModelNetworkFailure('response_invalid');
		}
		const summary = value.summary.map((part: unknown) => {
			if (
				!part ||
				typeof part !== 'object' ||
				Array.isArray(part) ||
				!('type' in part) ||
				part.type !== 'summary_text' ||
				!('text' in part) ||
				typeof part.text !== 'string'
			) {
				throw new ModelNetworkFailure('response_invalid');
			}
			return part.text;
		});
		bytes += Buffer.byteLength(JSON.stringify(value), 'utf8');
		if (bytes > MODEL_REASONING_MAX_BYTES) {
			throw new ModelNetworkFailure('too_large');
		}
		if (result.some((item) => item.id === value.id)) {
			throw new ModelNetworkFailure('response_invalid');
		}
		result.push({ id: value.id, encryptedContent: value.encrypted_content, summary });
	}
	return result;
}
