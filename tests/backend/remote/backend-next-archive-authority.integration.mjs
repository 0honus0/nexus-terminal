import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { openWorkspace, until } from './openssh-fixture.mjs';
import { remoteFilesFixture, transferEvent } from './file-transfer-fixture.mjs';
import { WorkspaceService } from '../../../packages/backend/dist/modules/remote/sessions/service/workspace-service.js';
import { SftpFileResource } from '../../../packages/backend/dist/modules/remote/files/model/file-resource.js';
import { FileArchiveModel } from '../../../packages/backend/dist/modules/remote/files/model/file-archive-model.js';

function success(response) {
	assert.equal(response.ok, true, JSON.stringify(response));
	return response.data;
}

await test(
	'Real archive prepare, dispatch and publication cannot cross a suspended owner lease',
	{ timeout: 60000 },
	async (t) => {
		const f = await remoteFilesFixture(t);
		f.state.allowUnknownShutdown = true;
		const cases = [];
		const sockets = [];
		t.after(async () => {
			const results = await Promise.allSettled(sockets.map((socket) => socket.close()));
			for (const result of results) if (result.status === 'rejected') throw result.reason;
		});
		// Only defer the scanner; the actual lease clock and per-operation authority remain unchanged.
		t.mock.method(WorkspaceService.prototype, 'sweepSuspendedLeases', () => undefined);
		for (const phase of ['prepare', 'dispatch', 'publish']) {
			const endpoint = await f.endpoint(phase);
			const source = join(endpoint.root, 'source.txt');
			const destination = join(endpoint.root, 'existing.zip');
			await writeFile(source, 'real native archive input');
			await writeFile(destination, 'original archive destination');
			const mark = success(await endpoint.workspace.call('suspend.mark', {}));
			success(await endpoint.workspace.call('suspend.prepare', {}));
			success(await endpoint.workspace.call('suspend.commit', {}));
			await endpoint.workspace.close();
			const workspace = await openWorkspace(f.address, f.cookie);
			sockets.push(workspace);
			const view = success(
				await workspace.call('suspend.resume', {
					suspendedSessionId: mark.suspendedSessionId,
					workspaceId: randomUUID(),
				}),
			);
			success(
				await workspace.call('suspend.resumeAck', {
					suspendedSessionId: mark.suspendedSessionId,
					resumeToken: view.resumeToken,
					attachmentGeneration: view.attachmentGeneration,
					ownershipGeneration: view.ownershipGeneration,
				}),
			);
			const ready = await until(
				() => workspace.events.find((event) => ['filesystem.ready', 'filesystem.error'].includes(event.type)),
				Boolean,
				'resumed Files owner ready',
			);
			assert.equal(ready.type, 'filesystem.ready', JSON.stringify(ready));
			const renewal = success(await workspace.call('suspend.owner.renew', {}));
			assert.ok(renewal.leaseExpiresAt - Date.now() >= 44000);
			cases.push({
				phase,
				endpoint,
				workspace,
				source,
				destination,
				expiresAt: renewal.leaseExpiresAt,
				held: false,
				commands: 0,
			});
		}
		const originalStat = SftpFileResource.prototype.stat;
		const originalCompress = FileArchiveModel.prototype.compress;
		const originalExecute = SftpFileResource.prototype.executeCommandLines;

		async function hold(value) {
			assert.ok(value.expiresAt > Date.now(), 'operation reached its real boundary while authorized');
			value.held = true;
			await delay(Math.max(1, value.expiresAt - Date.now() + 20));
		}

		t.mock.method(SftpFileResource.prototype, 'stat', async function (request) {
			const result = await originalStat.call(this, request);
			const value = cases.find(
				(item) =>
					(item.phase === 'prepare' && request.path === item.source) ||
					(item.phase === 'publish' && request.path.startsWith(join(item.endpoint.root, '.nexus-archive-'))),
			);
			if (value && !value.held) await hold(value);
			return result;
		});
		t.mock.method(FileArchiveModel.prototype, 'compress', async function (...args) {
			const value = cases.find((item) => item.phase === 'dispatch' && args[1].includes(item.source));
			if (value) await hold(value);
			return originalCompress.apply(this, args);
		});
		t.mock.method(SftpFileResource.prototype, 'executeCommandLines', async function (...args) {
			for (const value of cases) if (args[0].includes(value.endpoint.root)) value.commands++;
			return originalExecute.apply(this, args);
		});
		await Promise.all(
			cases.map(async (value) => {
				value.requestId = randomUUID();
				success(
					await value.workspace.call(
						'transfer.compress',
						{ sources: [value.source], destination: value.destination, format: 'zip' },
						value.requestId,
					),
				);
			}),
		);
		await until(() => cases.every((value) => value.held), Boolean, 'all three real archive boundaries reached');
		await delay(Math.max(0, Math.max(...cases.map((value) => value.expiresAt)) - Date.now() + 50));
		await Promise.all(
			cases.map(async (value) => {
				const event = await transferEvent(value.workspace, 'transfer.archive', value.requestId, [
					'failed',
					'completed',
				]);
				assert.equal(event.payload.type, 'failed');
				assert.equal(event.payload.message, 'operation_unknown');
				assert.deepEqual(await readFile(value.destination), Buffer.from('original archive destination'));
				assert.equal(await readFile(value.source, 'utf8'), 'real native archive input');
				assert.equal(value.commands > 0, value.phase === 'publish');
				assert.deepEqual(
					(await readdir(value.endpoint.root)).filter((name) => name.startsWith('.nexus-archive-')),
					[],
				);
			}),
		);
	},
);
