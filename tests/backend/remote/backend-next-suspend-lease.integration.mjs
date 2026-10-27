import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, stat, readdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import WebSocket from '../../../packages/backend/node_modules/ws/index.js';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { openWorkspace, until, send, expectStatus, origin } from './openssh-fixture.mjs';
import { remoteFilesFixture, fileHandles } from './file-transfer-fixture.mjs';
import { WorkspaceService } from '../../../packages/backend/dist/modules/remote/sessions/service/workspace-service.js';

function success(response) {
	assert.equal(response.ok, true, JSON.stringify(response));
	return response.data;
}

function acknowledgement(mark, view) {
	return {
		suspendedSessionId: mark.suspendedSessionId,
		resumeToken: view.resumeToken,
		attachmentGeneration: view.attachmentGeneration,
		ownershipGeneration: view.ownershipGeneration,
	};
}

function uploadEvent(workspace, uploadId, types) {
	return until(
		() =>
			workspace.events.find(
				(event) =>
					event.type === 'transfer.upload' &&
					event.payload.uploadId === uploadId &&
					types.includes(event.payload.type),
			),
		Boolean,
		'Upload lease event ' + types.join('/'),
	);
}

await test('A suspended owner expires at its actual lease deadline and a new owner keeps the original PTY', async (t) => {
	let delaySweep = false;
	const sweep = WorkspaceService.prototype.sweepSuspendedLeases;
	t.mock.method(WorkspaceService.prototype, 'sweepSuspendedLeases', function () {
		if (!delaySweep) {
			sweep.call(this);
		}
	});
	const f = await remoteFilesFixture(t);
	const original = await f.endpoint('lease');
	const pidPath = join(original.root, 'shell.pid');
	success(await original.workspace.call('terminal.input', { data: `echo $$ > '${pidPath}'\n` }));
	const pid = Number(
		await until(
			() =>
				readFile(pidPath, 'utf8').catch((error) => {
					if (error.code === 'ENOENT') {
						return '';
					}
					throw error;
				}),
			Boolean,
			'Original lease shell',
		),
	);
	const mark = success(await original.workspace.call('suspend.mark', {}));
	success(await original.workspace.call('suspend.prepare', {}));
	success(await original.workspace.call('suspend.commit', {}));
	await original.workspace.close();
	const owner = await openWorkspace(f.address, f.cookie);
	t.after(() => owner.close());
	const first = success(
		await owner.call('suspend.resume', { suspendedSessionId: mark.suspendedSessionId, workspaceId: randomUUID() }),
	);
	success(await owner.call('suspend.resumeAck', acknowledgement(mark, first)));
	const renewed = success(await owner.call('suspend.owner.renew', {}));
	assert.ok(
		renewed.leaseExpiresAt - Date.now() >= 44000,
		'use the actual 45-second lease, without changing clocks or TTL',
	);
	const next = await openWorkspace(f.address, f.cookie);
	t.after(() => next.close());
	assert.equal(
		(await next.call('suspend.resume', { suspendedSessionId: mark.suspendedSessionId, workspaceId: randomUUID() }))
			.ok,
		false,
		'live owner is not silently taken over',
	);
	// Hold only the scanner, not the actual lease clock or per-operation checks.
	// Expired operations must be fenced even before the next two-second sweep.
	delaySweep = true;
	await delay(Math.max(0, renewed.leaseExpiresAt - Date.now() - 3000));
	const destinationPath = join(original.root, 'lease-upload');
	const existingBytes = Buffer.from('original destination');
	await writeFile(destinationPath, existingBytes);
	const uploadId = randomUUID();
	const chunk = Buffer.alloc(2048, 75);
	success(
		await owner.call('upload.start', {
			uploadId,
			destinationPath,
			size: chunk.length * 2,
			conflictPolicy: 'overwrite',
		}),
	);
	assert.equal((await uploadEvent(owner, uploadId, ['ready', 'failed'])).payload.type, 'ready');
	const query = new URLSearchParams({ workspaceId: first.workspaceId, uploadId, size: String(chunk.length * 2) });
	const stream = new WebSocket('ws://' + f.address + '/ws/uploads?' + query, {
		origin,
		headers: { Host: new URL(origin).host, Cookie: f.cookie, 'Sec-Fetch-Site': 'same-origin' },
	});
	const streamClosed = new Promise((resolve) => stream.once('close', (code) => resolve(code)));
	t.after(async () => {
		if (stream.readyState !== stream.CLOSED) {
			stream.terminate();
		}
		await streamClosed;
	});
	await once(stream, 'open');
	stream.send(chunk);
	assert.equal((await uploadEvent(owner, uploadId, ['progress', 'failed'])).payload.bytesWritten, chunk.length);
	const stageName = (await readdir(original.root)).find((name) => name.startsWith('.nexus-upload-'));
	assert.ok(stageName);
	assert.deepEqual(await readFile(join(original.root, stageName)), chunk);
	assert.ok(Date.now() < renewed.leaseExpiresAt, 'first real write precedes natural lease expiry');
	f.state.allowUnknownShutdown = true;
	await delay(Math.max(0, renewed.leaseExpiresAt - Date.now() + 20));
	assert.equal(owner.socket.readyState, owner.socket.OPEN);
	assert.equal(
		owner.events.some((event) => event.type === 'suspend.revoked'),
		false,
	);
	stream.send(chunk);
	assert.equal(await streamClosed, 1011, 'upload data channel also rejects an expired owner before sweep');
	assert.deepEqual(await readFile(destinationPath), existingBytes);
	const forbidden = join(original.root, 'expired-owner-write');
	for (const [type, payload] of [
		['terminal.input', { data: `printf forbidden > '${forbidden}'\n` }],
		['terminal.resize', { columns: 120, rows: 40 }],
		['filesystem.writeText', { path: forbidden, content: 'forbidden', encoding: 'utf-8' }],
		['filesystem.createDirectory', { path: forbidden }],
		['suspend.owner.renew', {}],
		['suspend.unmark', {}],
		['suspend.history.reset', {}],
	]) {
		const denied = await owner.call(type, payload);
		assert.equal(denied.ok, false, type);
		assert.equal(denied.error, 'not_found', type);
	}
	await assert.rejects(stat(forbidden), { code: 'ENOENT' });
	const management = '/api/v1/ssh-suspend';
	const listed = expectStatus(await send(f.address, f.cookie, 'GET', management + '/suspended-sessions'), 200);
	const available = listed.find((value) => value.id === mark.suspendedSessionId);
	assert.ok(available);
	assert.equal(available.ownershipState, 'available');
	assert.equal(available.attachedWorkspaceId, undefined);
	assert.equal(available.ownershipLeaseExpiresAt, undefined);
	expectStatus(
		await send(f.address, f.cookie, 'PUT', management + '/name/' + mark.suspendedSessionId, {
			customName: 'Expired owner still managed by current identity',
		}),
		200,
	);
	const unauthenticated = expectStatus(
		await send(f.address, '', 'PUT', management + '/name/' + mark.suspendedSessionId, {
			customName: 'forbidden',
		}),
		401,
	);
	assert.equal(unauthenticated.code, 'unauthenticated');
	delaySweep = false;
	const replacement = success(
		await next.call('suspend.resume', { suspendedSessionId: mark.suspendedSessionId, workspaceId: randomUUID() }),
	);
	assert.equal(replacement.ownershipGeneration, first.ownershipGeneration + 1);
	success(await next.call('suspend.resumeAck', acknowledgement(mark, replacement)));
	assert.equal((await owner.closed)[0], 1008);
	assert.ok(owner.events.some((event) => event.type === 'suspend.revoked'));
	const confirmation = join(original.root, 'same-shell.pid');
	success(await next.call('terminal.input', { data: `echo $$ > '${confirmation}'\n` }));
	assert.equal(
		Number(
			await until(
				() =>
					readFile(confirmation, 'utf8').catch((error) => {
						if (error.code === 'ENOENT') {
							return '';
						}
						throw error;
					}),
				Boolean,
				'Original PTY remains after natural lease expiry',
			),
		),
		pid,
	);
	assert.deepEqual(
		await next.call('workspace.close', {
			workspaceId: replacement.workspaceId,
			connectionId: replacement.connectionId,
			resumeToken: replacement.resumeToken,
			attachmentGeneration: replacement.attachmentGeneration,
		}),
		{ ok: false, error: 'operation_unknown' },
	);
	await until(
		() => {
			try {
				process.kill(pid, 0);
				return false;
			} catch (error) {
				if (error.code === 'ESRCH') {
					return true;
				}
				throw error;
			}
		},
		Boolean,
		'Final close actually stops the original PTY',
	);
	// Aborted remote cleanup remains unknown: preserve its temporary bytes,
	// while requiring the original handle and PTY to actually close.
	assert.deepEqual(await readFile(join(original.root, stageName)), chunk);
	assert.deepEqual(await fileHandles(join(original.root, stageName)), []);
	assert.deepEqual(await readFile(destinationPath), existingBytes);
});
