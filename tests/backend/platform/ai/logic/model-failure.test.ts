import { describe, expect, test } from 'vitest';
import { ModelNetworkFailure } from '../../../../../packages/backend/src/platform/ai/model-port';
import { modelSdkFailure } from '../../../../../packages/backend/src/platform/ai/adapters/model-sdk-request';

function wrapped(cause: Error, count: number): Error {
	let result = cause;
	for (let index = 0; index < count; index++) {
		result = new Error('Intermediate adapter failure', { cause: result });
	}
	return result;
}

describe('model failure cause ownership', () => {
	const signal = new AbortController().signal;

	test('retains the original structured failure through any number of wrappers', () => {
		const original = new ModelNetworkFailure('too_large');
		expect(modelSdkFailure(wrapped(original, 40), signal)).toBe(original);
	});

	test.each([
		['ENOTFOUND', 'dns'],
		['CERT_HAS_EXPIRED', 'tls'],
		['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
	] as const)('classifies a deeply wrapped %s without error text', (code, kind) => {
		const original = Object.assign(new Error('Opaque supplier error'), { code });
		const input = wrapped(original, 40);
		const failure = modelSdkFailure(input, signal);
		expect(failure.kind).toBe(kind);
		expect(failure.cause).toBe(input);
	});

	test('stops at cause cycles and preserves the complete original failure', () => {
		const first = new Error('First');
		const second = new Error('Second', { cause: first });
		first.cause = second;
		const failure = modelSdkFailure(first, signal);
		expect(failure.kind).toBe('network');
		expect(failure.cause).toBe(first);
	});
});
