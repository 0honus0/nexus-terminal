import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	readWorkspaceUploadPrepared,
	readWorkspaceTaskStarted,
	readWorkspaceTaskStopped,
	readWorkspaceUploadEvent,
} from '../../../../packages/shared/src/remote/transfers/workspace-codec.ts';

test('workspace upload codecs reject malformed facts and project safe fields', () => {
	assert.deepEqual(readWorkspaceUploadPrepared({ preparedDirectories: 20_002 }), { preparedDirectories: 20_002 });
	let codecChecks = 1;
	for (const [decode, invalid] of [
		[readWorkspaceUploadPrepared, { preparedDirectories: 0 }],
		[readWorkspaceTaskStarted, { started: 1 }],
		[readWorkspaceTaskStopped, { stopped: true }],
		[readWorkspaceUploadEvent, { type: 'failed', uploadId: 'u', message: 'technical secret' }],
		[
			readWorkspaceUploadEvent,
			{ type: 'progress', uploadId: 'u', chunkIndex: 0, bytesWritten: 2, totalSize: 1, progress: 100 },
		],
		[
			readWorkspaceUploadEvent,
			{ type: 'progress', uploadId: 'u', chunkIndex: 0, bytesWritten: 1, totalSize: 2, progress: 99 },
		],
		[readWorkspaceUploadEvent, { type: 'conflict', uploadId: 'u', destinationPath: '/one', filename: 'two' }],
		[readWorkspaceUploadEvent, { type: 'ready', uploadId: '' }],
	]) {
		assert.throws(() => decode(invalid));
		codecChecks++;
	}
	assert.deepEqual(readWorkspaceUploadPrepared({ preparedDirectories: 1, secret: true }), { preparedDirectories: 1 });
	assert.deepEqual(readWorkspaceTaskStarted({ started: true, secret: true }), { started: true });
	assert.equal(readWorkspaceTaskStopped(false), false);
	assert.deepEqual(readWorkspaceUploadEvent({ type: 'ready', uploadId: 'u', secret: true }), {
		type: 'ready',
		uploadId: 'u',
	});
	codecChecks += 4;
});
