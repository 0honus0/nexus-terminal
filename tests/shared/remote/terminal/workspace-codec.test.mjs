import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as terminal from '../../../../packages/shared/src/remote/terminal/workspace-codec.ts';
import { readWorkspaceMessage } from '../../../../packages/shared/src/remote/workspace/workspace-codec.ts';

test('workspace terminal codecs reject invalid wire facts without changing accepted payloads', () => {
	const queue = { requestId: 'id', path: '/目录', waitingForPrompt: true };
	assert.deepEqual(terminal.readWorkspaceTerminalDirectoryQueued({ ...queue, secret: 'discard' }), queue);
	let rejected = 0;
	for (const [decode, input] of [
		[terminal.readWorkspaceTerminalInput, { data: '\ud800' }],
		[terminal.readWorkspaceTerminalInput, { data: '中'.repeat(90000) }],
		[terminal.readWorkspaceTerminalResize, { columns: 1, rows: 24 }],
		[terminal.readWorkspaceTerminalResize, { columns: 80, rows: NaN }],
		[terminal.readWorkspaceTerminalFlow, { consumedBytes: -1 }],
		[terminal.readWorkspaceTerminalCurrentDirectory, null],
		[terminal.readWorkspaceTerminalCurrentDirectory, '/'.repeat(4097)],
		[terminal.readWorkspaceTerminalChangeDirectoryResponse, { queued: false }],
		[terminal.readWorkspaceTerminalClosed, null],
		[terminal.readWorkspaceTerminalError, { message: 'vendor secret' }],
		[terminal.readWorkspaceTerminalDirectoryQueued, { ...queue, waitingForPrompt: 1 }],
		[terminal.readWorkspaceTerminalDirectoryChanged, { requestId: '', path: '/' }],
		[terminal.readWorkspaceTerminalDirectoryFailed, { requestId: 'id', message: 'unknown_code' }],
	]) {
		assert.throws(() => decode(input));
		rejected += 1;
	}
	assert.equal(terminal.readWorkspaceTerminalInput({ data: 'x'.repeat(256 * 1024) }).data.length, 256 * 1024);
	assert.deepEqual(terminal.readWorkspaceTerminalDirectoryFailed({ requestId: 'id', message: 'replaced' }), {
		requestId: 'id',
		message: 'replaced',
	});
	assert.throws(() =>
		readWorkspaceMessage({ type: 'response', requestId: 'id', payload: { ok: false, error: 'secret' } }),
	);
});
