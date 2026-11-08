import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	readWorkspaceSuspendMark,
	readWorkspaceSuspendResume,
} from '@nexus-terminal/shared/remote/suspend/workspace-codec';
import {
	readWorkspaceSuspendResumeResponse,
	readWorkspaceSuspendRevoked,
} from '@nexus-terminal/shared/remote/suspend/workspace-result-codec';

test('suspend commands and ownership receipts reject malformed or private input', () => {
	assert.throws(() => readWorkspaceSuspendMark({ terminalSnapshot: 'x', secret: true }));
	assert.throws(() => readWorkspaceSuspendMark({ terminalSnapshot: 'x'.repeat(4 * 1024 * 1024 + 1) }));
	assert.throws(() =>
		readWorkspaceSuspendResume({
			suspendedSessionId: 'suspend-1',
			workspaceId: 'workspace-1',
			viewport: { columns: 80, rows: 24, secret: 1 },
		}),
	);
	assert.throws(() =>
		readWorkspaceSuspendRevoked({ suspendedSessionId: 'suspend-1', generation: 1, reason: 'arbitrary diagnosis' }),
	);
	assert.throws(() =>
		readWorkspaceSuspendRevoked({
			suspendedSessionId: 'suspend-1',
			generation: 1,
			reason: 'takeover',
			message: 'secret',
		}),
	);
	assert.throws(() => readWorkspaceSuspendResumeResponse({}));
});
