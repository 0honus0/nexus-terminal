import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { RemoteSessionService } from '../../../../../packages/backend/dist/modules/remote/sessions/service/session-service.js';
import { WorkspaceService } from '../../../../../packages/backend/dist/modules/remote/sessions/service/workspace-service.js';
import { expectStatus, send, until } from '../../../../support/protocols/openssh-fixture.mjs';
import { remoteFilesFixture } from '../../transfers/support/file-transfer-fixture.mjs';

for (const revoke of [false, true]) {
	await test(
		revoke
			? 'Cookie revocation still closes a Workspace channel during explicit close drain'
			: 'Explicit close retains its response channel across the natural authorization recheck',
		{ timeout: 15000 },
		async (t) => {
			const f = await remoteFilesFixture(t);
			const owner = await f.endpoint('close-drain');
			const drain = Promise.withResolvers();
			const entered = Promise.withResolvers();
			const closeSession = RemoteSessionService.prototype.closeSession;
			t.mock.method(RemoteSessionService.prototype, 'closeSession', async function (...args) {
				await closeSession.apply(this, args);
				// The real SSH release completes; hold only its completion delivery so
				// the actual Workspace remains closing across its unchanged 3s recheck.
				entered.resolve();
				await drain.promise;
			});
			let closingChecks = 0;
			const allowed = WorkspaceService.prototype.allowed;
			t.mock.method(WorkspaceService.prototype, 'allowed', async function (...args) {
				const result = await allowed.apply(this, args);
				if (!result && args[1] === owner.connection.workspaceId) closingChecks++;
				return result;
			});
			const requestId = randomUUID();
			const response = Promise.withResolvers();

			const onMessage = (bytes, binary) => {
				if (binary) return;
				const message = JSON.parse(bytes.toString());
				if (message.type === 'response' && message.requestId === requestId) response.resolve(message.payload);
			};

			owner.workspace.socket.on('message', onMessage);
			t.after(() => owner.workspace.socket.off('message', onMessage));
			try {
				owner.workspace.socket.send(
					JSON.stringify({
						type: 'workspace.close',
						requestId,
						payload: {
							workspaceId: owner.connection.workspaceId,
							connectionId: owner.connection.connectionId,
							resumeToken: owner.connection.resumeToken,
							attachmentGeneration: owner.connection.attachmentGeneration,
						},
					}),
				);
				await entered.promise;
				if (revoke) {
					expectStatus(await send(f.address, f.cookie, 'POST', '/api/v1/auth/logout', {}), 200);
					assert.equal((await owner.workspace.closed)[0], 1008);
				} else {
					await until(
						() => closingChecks,
						(count) => count > 0,
						'Natural closing ownership recheck',
					);
					assert.deepEqual(await owner.workspace.call('workspace.ping', {}), {
						ok: false,
						error: 'not_found',
					});
					drain.resolve();
					assert.deepEqual(await response.promise, { ok: true, data: null });
					assert.equal(owner.workspace.socket.readyState, owner.workspace.socket.OPEN);
				}
			} finally {
				drain.resolve();
			}
		},
	);
}
