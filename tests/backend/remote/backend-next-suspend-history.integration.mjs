import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from '../../../packages/backend/node_modules/ws/index.js';
import { WorkspaceService } from '../../../packages/backend/dist/modules/remote/sessions/service/workspace-service.js';
import { openWorkspace, until } from './openssh-fixture.mjs';
import { remoteFilesFixture } from './file-transfer-fixture.mjs';

function success(response) {
	assert.equal(response.ok, true, JSON.stringify(response));
	return response.data;
}

function gate() {
	let release;
	const promise = new Promise((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

async function resumedHistory(t) {
	const f = await remoteFilesFixture(t);
	const original = await f.endpoint('history-delivery');
	const marked = success(await original.workspace.call('suspend.mark', {}));
	const done = join(original.root, 'history.done');
	success(
		await original.workspace.call('terminal.input', {
			data: `head -c 786432 /dev/zero | tr '\\000' 'H'; echo done > '${done}'\n`,
		}),
	);
	await until(() => fs.stat(done).catch(() => null), Boolean, 'real history producer completed');
	const logPath = join(f.directory, 'temp_backend_next_suspended_ssh_logs', marked.suspendedSessionId + '.log');
	await until(
		() => fs.stat(logPath),
		(value) => value.size >= 786432,
		'real history is persisted',
	);
	await original.workspace.close();
	const workspace = await openWorkspace(f.address, f.cookie);
	t.after(() => workspace.close());
	const lease = success(
		await workspace.call('suspend.resume', {
			suspendedSessionId: marked.suspendedSessionId,
			workspaceId: randomUUID(),
		}),
	);
	const raw = await fs.readFile(logPath);
	let binding;
	const acknowledge = WorkspaceService.prototype.acknowledgeSuspendedResume;
	t.mock.method(WorkspaceService.prototype, 'acknowledgeSuspendedResume', async function (...args) {
		binding = { service: this, args: args.slice(0, 3) };
		return acknowledge.apply(this, args);
	});
	success(
		await workspace.call('suspend.resumeAck', {
			suspendedSessionId: marked.suspendedSessionId,
			resumeToken: lease.resumeToken,
			attachmentGeneration: lease.attachmentGeneration,
			ownershipGeneration: lease.ownershipGeneration,
		}),
	);
	return { f, workspace, binding, logPath, raw };
}

for (const frame of ['data', 'final']) {
	await test(`A failed actual WS history ${frame} frame leaves the page readable at its original cursor`, async (t) => {
		const { workspace } = await resumedHistory(t);
		const frames = new Map();
		workspace.socket.on('message', (data, binary) => {
			if (binary && data[5] === 2) {
				const idBytes = data.readUInt16BE(8);
				const id = data.subarray(16, 16 + idBytes).toString('utf8');
				const list = frames.get(id) ?? [];
				list.push(data.subarray(16 + idBytes));
				frames.set(id, list);
			}
		});
		const failedId = randomUUID();
		const send = WebSocket.prototype.send;
		let refused = 0;
		t.mock.method(WebSocket.prototype, 'send', function (data, ...args) {
			if (typeof data !== 'string' && data[5] === 2) {
				const bytes = Buffer.from(data);
				const idBytes = bytes.readUInt16BE(8);
				if (
					bytes.subarray(16, 16 + idBytes).toString('utf8') === failedId &&
					Boolean(bytes[6] & 1) === (frame === 'final')
				) {
					refused += 1;
					throw new Error('controlled server frame delivery failure');
				}
			}
			return send.call(this, data, ...args);
		});
		const failed = await workspace.call('suspend.history.previous', { maxBytes: 256 * 1024 }, failedId);
		assert.equal(failed.ok, false);
		assert.equal(refused, 1);
		assert.equal(frames.has(failedId), frame === 'final');
		const retryId = randomUUID();
		success(await workspace.call('suspend.history.previous', { maxBytes: 256 * 1024 }, retryId));
		const retry = Buffer.concat(frames.get(retryId));
		assert.equal(retry.length, 256 * 1024);
		if (frame === 'final') {
			assert.deepEqual(
				Buffer.concat(frames.get(failedId)),
				retry,
				'data sent before the failed final frame remains retryable',
			);
		}
		success(await workspace.call('suspend.history.reset', {}));
		const repeatedId = randomUUID();
		success(await workspace.call('suspend.history.previous', { maxBytes: 256 * 1024 }, repeatedId));
		assert.deepEqual(Buffer.concat(frames.get(repeatedId)), retry, 'failed delivery did not skip a history page');
	});
}

await test('History reset waits for an in-flight delivery and concurrent pages retain their exact ordering', async (t) => {
	const release = gate();
	t.after(() => release.release());
	const { binding, raw } = await resumedHistory(t);
	const { service, args } = binding;
	const entered = gate();
	let firstBytes;
	const first = service.suspendHistoryPrevious(
		...args,
		async (bytes) => {
			firstBytes = Buffer.from(bytes);
			entered.release();
			await release.promise;
		},
		256 * 1024,
	);
	await entered.promise;
	let resetDone = false;
	const resetting = service.resetSuspendHistory(...args).then((value) => {
		resetDone = true;
		return value;
	});
	let nextBytes;
	const next = service.suspendHistoryPrevious(
		...args,
		async (bytes) => {
			nextBytes = Buffer.from(bytes);
		},
		256 * 1024,
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(resetDone, false);
	assert.equal(nextBytes, undefined);
	release.release();
	await first;
	assert.equal(await resetting, true);
	await next;
	assert.deepEqual(nextBytes, firstBytes, 'reset runs between the two queued page deliveries');
	const pages = [];
	await Promise.all(
		[0, 1].map(() =>
			service.suspendHistoryPrevious(
				...args,
				async (bytes) => {
					pages.push(Buffer.from(bytes));
				},
				256 * 1024,
			),
		),
	);
	assert.equal(pages.length, 2);
	assert.equal(pages[0].length, 256 * 1024);
	assert.ok(pages[1].length > 0);
	const remaining = [];
	let more = true;
	while (more) {
		const result = await service.suspendHistoryPrevious(
			...args,
			async (bytes) => {
				remaining.push(Buffer.from(bytes));
			},
			256 * 1024,
		);
		more = result.hasMore;
	}
	assert.deepEqual(Buffer.concat([...remaining.reverse(), ...pages.reverse(), firstBytes]), raw);
});
