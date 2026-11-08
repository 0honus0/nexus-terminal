import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as files from '../../../../packages/shared/src/remote/files/workspace-codec.ts';

test('workspace files codecs reject invalid wire facts without changing accepted payloads', () => {
	const metadata = {
		size: 4,
		uid: 1,
		gid: 2,
		mode: 0o100644,
		accessedAt: 1700000000000,
		modifiedAt: 1700000000000,
		isFile: true,
		isDirectory: false,
		isSymbolicLink: false,
	};
	const entry = { name: 'a.txt', path: '/root/a.txt', metadata };
	assert.deepEqual(files.readWorkspaceFileEntry({ ...entry, secret: 'discard' }), entry);
	assert.deepEqual(files.readWorkspaceFileEntry({ ...entry, metadata: { ...metadata, secret: 'discard' } }), entry);
	assert.equal(
		files.readWorkspaceFileListResponse({ path: '/', entries: Array(20001).fill(entry) }).entries.length,
		20001,
	);
	assert.equal(
		files.readWorkspaceFileSearchResponse({
			entries: Array(501).fill({ ...entry, relativePath: 'a.txt' }),
			truncated: true,
		}).entries.length,
		501,
	);
	let rejected = 0;
	for (const [decode, input] of [
		[files.readWorkspaceFileMetadata, { ...metadata, size: -1 }],
		[files.readWorkspaceFileMetadata, { ...metadata, modifiedAt: '1700000000000' }],
		[files.readWorkspaceFileMetadata, { ...metadata, isDirectory: true }],
		[files.readWorkspaceFileMetadata, { ...metadata, mode: 2 ** 32 }],
		[files.readWorkspaceFileEntry, { ...entry, name: 'bad/name' }],
		[files.readWorkspaceFileEntry, { ...entry, path: '/bad\ud800' }],
		[files.readWorkspaceFileSearchResponse, { entries: [], truncated: 1 }],
		[files.readWorkspaceFileSearchResponse, { entries: [{ ...entry, relativePath: 1 }], truncated: true }],
		[files.readWorkspaceFileMutationResponse, { ok: true }],
		[files.readWorkspaceFileReadBinaryResponse, { path: 1 }],
		[
			files.readWorkspaceFileRealpathResponse,
			{ requestedPath: '/', absolutePath: '/target', targetType: 'symlink' },
		],
		[files.readWorkspaceFileError, { message: 'private vendor failure' }],
		[files.readWorkspaceFileReady, null],
	]) {
		assert.throws(() => decode(input));
		rejected += 1;
	}
	assert.equal(files.readWorkspaceFileCancelReadResponse(false), false);
	assert.deepEqual(files.readWorkspaceFileError({ message: 'operation_unknown' }), { message: 'operation_unknown' });
});
