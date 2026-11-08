import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	readWorkspaceConnectResponse,
	readWorkspaceEmptyResponse,
} from '@nexus-terminal/shared/remote/workspace/workspace-codec';

test('workspace receipts validate replay bounds, generations, timestamps and protocol without exposing extras', () => {
	const sample = {
		workspaceId: 'workspace-codec',
		connectionId: 1,
		connectionName: 'name',
		binaryProtocolVersion: 1,
		resumeToken: 'credential',
		attachmentGeneration: 1,
		terminalOffset: 10,
		replayedBytes: 4,
		lastConnectedAt: 1700000000,
	};
	assert.deepEqual(readWorkspaceConnectResponse({ ...sample, privateValue: 'hidden' }), sample);
	for (const patch of [
		{ replayedBytes: undefined },
		{ replayedBytes: 11 },
		{ terminalOffset: NaN },
		{ attachmentGeneration: 0 },
		{ lastConnectedAt: Number.MAX_SAFE_INTEGER },
		{ connectionName: 'x'.repeat(129) },
		{ binaryProtocolVersion: 2 },
	])
		assert.throws(() => readWorkspaceConnectResponse({ ...sample, ...patch }));
	assert.equal(readWorkspaceEmptyResponse(null), null);
	assert.throws(() => readWorkspaceEmptyResponse({}));
});
