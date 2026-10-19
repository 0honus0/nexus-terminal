import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { remoteFilesFixture } from './file-transfer-fixture.mjs';
import { openWorkspace } from './openssh-fixture.mjs';

test('a separate authorized socket closes only a detached Workspace with its exact resume capability', async (t) => {
	const f = await remoteFilesFixture(t);
	const owner = await f.endpoint('detached-close');
	const input = {
		workspaceId: owner.connection.workspaceId,
		connectionId: owner.target.id,
		resumeToken: owner.connection.resumeToken,
		attachmentGeneration: owner.connection.attachmentGeneration,
	};
	const closer = await openWorkspace(f.address, f.cookie);
	t.after(() => closer.close());

	assert.deepEqual(await closer.call('workspace.close', input), { ok: false, error: 'conflict' });
	assert.equal((await owner.workspace.call('terminal.currentDirectory', {})).ok, true);

	await owner.workspace.close();
	assert.deepEqual(await closer.call('workspace.close', { ...input, resumeToken: randomUUID() }), {
		ok: false,
		error: 'not_found',
	});
	assert.deepEqual(await closer.call('workspace.close', input), { ok: true, data: null });
	assert.deepEqual(
		await closer.call('workspace.resume', { ...input, terminalOffset: owner.connection.terminalOffset }),
		{ ok: false, error: 'not_found' },
	);
});
