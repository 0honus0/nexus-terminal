import assert from 'node:assert/strict';
import { test } from 'vitest';
import { InvalidAccessPayload, readAccessHttpError } from '../../../packages/shared/src/access/http.ts';

test('Access public errors retain rate limiting and factor availability while rejecting unknown codes', () => {
	// Every login error emitted by Access must survive the shared client decoder.
	assert.deepEqual(readAccessHttpError({ code: 'rate_limited' }), { code: 'rate_limited' });
	assert.deepEqual(readAccessHttpError({ code: 'factor_unavailable' }), { code: 'factor_unavailable' });
	assert.throws(() => readAccessHttpError({ code: 'not_a_public_error' }), InvalidAccessPayload);
});
