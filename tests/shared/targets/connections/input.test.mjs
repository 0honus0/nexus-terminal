import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readConnectionInput } from '../../../../packages/shared/src/targets/connections/http-codec.ts';
import { InvalidTargetPayload } from '../../../../packages/shared/src/targets/http.ts';

test('SSH input rejects RDP-only configuration at the protocol boundary', () => {
	assert.throws(
		() =>
			readConnectionInput({
				name: 'invalid-ssh',
				type: 'SSH',
				host: 'localhost',
				port: 22,
				username: 'tester',
				route: 'direct',
				proxyId: null,
				jumpIds: [],
				tagIds: [],
				notes: null,
				rdpRemoteApp: 'notepad',
			}),
		InvalidTargetPayload,
	);
});
