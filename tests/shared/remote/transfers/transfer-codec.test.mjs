import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	readWorkspaceCopyMoveEvent,
	readWorkspaceArchiveEvent,
} from '../../../../packages/shared/src/remote/transfers/task-codec.ts';

test('workspace transfer codecs reject malformed facts and project safe fields', () => {
	let codecChecks = 0;
	for (const [read, value] of [
		[readWorkspaceCopyMoveEvent, { type: 'failed', requestId: 'a', mode: 'copy', message: 'ssh secret' }],
		[
			readWorkspaceCopyMoveEvent,
			{
				type: 'progress',
				requestId: 'a',
				transferredBytes: 2,
				totalBytes: 1,
				completedFiles: 1,
				totalFiles: 1,
				totalKnown: true,
			},
		],
		[
			readWorkspaceCopyMoveEvent,
			{
				type: 'progress',
				requestId: 'a',
				transferredBytes: -1,
				totalBytes: 1,
				completedFiles: 1,
				totalFiles: 1,
				totalKnown: false,
			},
		],
		[
			readWorkspaceArchiveEvent,
			{ type: 'failed', requestId: 'a', operation: 'compress', message: 'INVALID_PASSWORD' },
		],
		[
			readWorkspaceArchiveEvent,
			{
				type: 'failed',
				requestId: 'a',
				operation: 'compress',
				message: 'COMMAND_NOT_FOUND',
				code: 'COMMAND_NOT_FOUND',
				commandNotFound: 'secret',
			},
		],
		[
			readWorkspaceArchiveEvent,
			{ type: 'completed', requestId: 'a', operation: 'compress', path: '/a.zip', warning: 'raw diagnostic' },
		],
		[
			readWorkspaceArchiveEvent,
			{ type: 'completed', requestId: 'a', operation: 'decompress', path: '/a', warning: 'verified_warning' },
		],
		[
			readWorkspaceArchiveEvent,
			{ type: 'progress', requestId: 'a', operation: 'compress', fileCount: 2, totalFiles: 1 },
		],
		[
			readWorkspaceArchiveEvent,
			{ type: 'progress', requestId: 'a', operation: 'compress', fileCount: 1, percent: 101 },
		],
	]) {
		assert.throws(() => read(value));
		codecChecks++;
	}
	assert.deepEqual(
		readWorkspaceArchiveEvent({ type: 'cancelled', requestId: 'a', operation: 'compress', secret: true }),
		{ type: 'cancelled', requestId: 'a', operation: 'compress' },
	);
	codecChecks++;
	assert.equal(
		readWorkspaceCopyMoveEvent({
			type: 'progress',
			requestId: 'a',
			transferredBytes: 1,
			totalBytes: 1,
			completedFiles: 3,
			totalFiles: 1,
			totalKnown: false,
		}).completedFiles,
		3,
	);
	codecChecks++;
});
