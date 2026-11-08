// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { attachDesktopClipboard } from '../../../../packages/frontend/src/features/remote-desktop/adapters/desktop-clipboard.ts';

test('desktop clipboard rejects oversized text explicitly and ignores retired deliveries', async () => {
	const checks = [];

	const check = (value, name) => {
		if (!value) throw Error(name);
		checks.push(name);
	};

	const failures = [];
	const bridge = attachDesktopClipboard(
		document.createElement('div'),
		async () => {},
		(failure) => failures.push(failure),
	);
	bridge.receive('a'.repeat(1024 * 1024 + 1));
	check(
		failures.length === 1 && failures[0].code === 'input_failed',
		'remote clipboard rejects oversized text without truncation',
	);
	bridge.close();
	bridge.receive('a'.repeat(1024 * 1024 + 1));
	check(failures.length === 1, 'clipboard retirement ignores later data');

	assert.equal(checks.length, 2);
});
