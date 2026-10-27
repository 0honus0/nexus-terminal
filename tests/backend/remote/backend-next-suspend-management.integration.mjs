import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	readSuspendedSessionCatalog,
	readSuspendedSessionRenameResponse,
	readSuspendedSessionTerminated,
	readSuspendedSessionError,
} from '../../../packages/shared/dist/remote/suspend/http-codec.js';
import { remoteFilesFixture } from './file-transfer-fixture.mjs';
import { send, expectStatus } from './openssh-fixture.mjs';

await test('suspended management HTTP uses real SSH owner and exact Shared contracts', async (t) => {
	const f = await remoteFilesFixture(t);
	const owner = await f.endpoint('suspend-management');
	const marked = await owner.workspace.call('suspend.mark', { terminalSnapshot: 'management log\r\n' });
	assert.equal(marked.ok, true, JSON.stringify(marked));
	const id = marked.data.suspendedSessionId;
	const root = '/api/v1/ssh-suspend';
	const catalog = await send(f.address, f.cookie, 'GET', root + '/suspended-sessions');
	expectStatus(catalog, 200);
	const view = readSuspendedSessionCatalog(catalog.body).find((item) => item.id === id);
	assert.ok(view);
	assert.equal(view.connectionId, owner.target.id);
	assert.equal(view.status, 'active');
	assert.equal(view.ownershipState, 'attached');
	assert.ok(view.ownershipLeaseExpiresAt > Date.now());
	const renamed = await send(f.address, f.cookie, 'PUT', root + '/name/' + id, { customName: '  管理 SSH  ' });
	expectStatus(renamed, 200);
	assert.equal(readSuspendedSessionRenameResponse(renamed.body).customName, '管理 SSH');
	const invalid = await send(f.address, f.cookie, 'PUT', root + '/name/' + id, {
		customName: 'name',
		private: 'forbidden',
	});
	expectStatus(invalid, 400);
	assert.equal(readSuspendedSessionError(invalid.body).code, 'invalid_input');
	const tooLarge = await send(f.address, f.cookie, 'PUT', root + '/name/' + id, { customName: 'x'.repeat(4096) });
	expectStatus(tooLarge, 413);
	assert.equal(readSuspendedSessionError(tooLarge.body).code, 'body_too_large');
	const unauthenticated = await send(f.address, '', 'GET', root + '/suspended-sessions');
	expectStatus(unauthenticated, 401);
	assert.equal(readSuspendedSessionError(unauthenticated.body).code, 'unauthenticated');
	const activeEntry = await send(f.address, f.cookie, 'DELETE', root + '/entry/' + id);
	expectStatus(activeEntry, 404);
	assert.equal(readSuspendedSessionError(activeEntry.body).code, 'not_found');
	const terminated = await send(f.address, f.cookie, 'DELETE', root + '/terminate/' + id);
	expectStatus(terminated, 200);
	readSuspendedSessionTerminated(terminated.body);
	const remaining = await send(f.address, f.cookie, 'GET', root + '/suspended-sessions');
	expectStatus(remaining, 200);
	assert.equal(
		readSuspendedSessionCatalog(remaining.body).some((item) => item.id === id),
		false,
	);
});
