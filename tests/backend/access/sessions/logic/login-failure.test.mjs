import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	nextLoginFailure,
	mayAttemptLogin,
} from '../../../../../packages/backend/src/modules/access/sessions/login-failure-rules.ts';

test('Login failure windows preserve an active ban and reset exactly at its expiry', () => {
	const limits = { maxAttempts: 3, windowMs: 10000, banMs: 20000 };
	const blocked = { attempts: 3, windowStartedAt: 0, blockedUntil: 20000, lastAttemptAt: 0 };
	assert.equal(nextLoginFailure(blocked, 15000, limits).blockedUntil, 20000, 'active ban must not extend');
	assert.equal(mayAttemptLogin(blocked, 19999), false);
	assert.equal(mayAttemptLogin(blocked, 20000), true);
	assert.deepEqual(nextLoginFailure(blocked, 20000, limits), {
		attempts: 1,
		windowStartedAt: 20000,
		blockedUntil: 0,
		lastAttemptAt: 20000,
	});
	assert.equal(mayAttemptLogin(null, 0), true);
});
