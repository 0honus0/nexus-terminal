import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NativeArchiveCommands } from '../../../packages/backend/dist/platform/archive/adapters/native/archive-commands.js';

test('ZIP names, extraction and symlink validation share a UTF-8 locale', async () => {
	const commands = [];
	const intercepted = new Error('Native command intercepted before dispatch');
	const runner = {
		async executeLines(command) {
			commands.push(command);
			throw intercepted;
		},
	};
	const subject = new NativeArchiveCommands(runner);
	const signal = new AbortController().signal;
	for (const action of [
		() => subject.list('/unicode.zip', 'zip', () => 9000, signal),
		() =>
			subject.extract(
				{ snapshot: '/unicode.zip', stage: '/stage', format: 'zip', excludedMembers: [], hasContent: true },
				() => 9000,
				signal,
			),
		() => subject.readZipLinkTarget('/unicode.zip', 'link', () => 9000, signal),
	]) {
		await assert.rejects(action(), (error) => error === intercepted);
	}
	assert.equal(commands.length, 3);
	for (const command of commands) {
		assert.ok(command.includes('LC_ALL=C.UTF-8; export LC_ALL'));
	}
});
