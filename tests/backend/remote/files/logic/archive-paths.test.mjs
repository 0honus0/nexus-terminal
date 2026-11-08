import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	validateListing,
	resolveLinkTargets,
	resolveHardlinkTargets,
} from '../../../../../packages/backend/src/modules/remote/files/file-archive-rules.ts';
import { RemoteFileFailure } from '../../../../../packages/backend/src/modules/remote/files/model/file-types.ts';

const rejected = (error) => error instanceof RemoteFileFailure && error.code === 'invalid_input';

const member = (kind, linkTarget = null) => ({
	kind,
	hardlink: kind === 'hardlink',
	size: 1,
	mode: 0o644,
	rawName: 'target',
	linkTarget,
});

test.each(['tar', 'zip'])('%s listings reject dot and parent segments before extraction', (format) => {
	for (const name of ['folder/./target', 'folder/../target', 'folder//target']) {
		assert.throws(() => validateListing([name], [{ ...member('file'), name }], format, '/archive.tar'), rejected);
	}
});

test('root-relative symlinks resolve dot segments and still reject root escapes', () => {
	const entries = new Map([
		['link', member('symlink', './target')],
		['target', member('file')],
	]);
	assert.equal(resolveLinkTargets(entries).get('link').destination, 'target');
	entries.set('link', member('symlink', '../target'));
	assert.throws(() => resolveLinkTargets(entries), rejected);
});

test('hardlinks reject embedded dot segments while allowing a root prefix', () => {
	const entries = new Map([
		['link', member('hardlink', './target')],
		['target', member('file')],
	]);
	assert.equal(resolveHardlinkTargets(entries).get('link').target, 'target');
	entries.set('link', member('hardlink', 'folder/./target'));
	assert.throws(() => resolveHardlinkTargets(entries), rejected);
});
