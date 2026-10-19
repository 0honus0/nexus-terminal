import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { HeadlessTerminalLogRenderer } from '../../../packages/backend/dist/platform/terminal/adapters/headless-suspended-log-export.js';
import { WorkspaceHistoryModel } from '../../../packages/backend/dist/modules/remote/sessions/model/workspace-history-model.js';
import { origin, send, expectStatus, until } from './openssh-fixture.mjs';
import { fileHandles, remoteFilesFixture } from './file-transfer-fixture.mjs';

function gate() {
	let release;
	const promise = new Promise((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

async function fixture(t) {
	const f = await remoteFilesFixture(t);
	const owner = await f.endpoint('log-export');
	const marked = await owner.workspace.call('suspend.mark', { terminalSnapshot: 'B10 export original\r\n' });
	assert.equal(marked.ok, true, JSON.stringify(marked));
	const id = marked.data.suspendedSessionId;
	return {
		...f,
		owner,
		path: '/api/v1/ssh-suspend/log/' + id,
		logPath: join(f.directory, 'temp_backend_next_suspended_ssh_logs', id + '.log'),
	};
}

function holdRenderer(t, release) {
	const render = HeadlessTerminalLogRenderer.prototype.render;
	let started = 0;
	t.mock.method(HeadlessTerminalLogRenderer.prototype, 'render', async function (...args) {
		const output = await render.apply(this, args);
		started += 1;
		await release.promise;
		return output;
	});
	return () => started;
}

await test('Suspended HTTP export reauthenticates after actual log rendering and releases the original file', async (t) => {
	const release = gate();
	t.after(() => release.release());
	const f = await fixture(t);
	const started = holdRenderer(t, release);
	const pending = send(f.address, f.cookie, 'GET', f.path);
	await until(started, (count) => count === 1, 'actual renderer has opened its input');
	expectStatus(await send(f.address, f.cookie, 'POST', '/api/v1/auth/logout', {}), 200);
	release.release();
	const response = await pending;
	expectStatus(response, 401);
	assert.deepEqual(response.body, { code: 'unauthenticated' });
	assert.equal(response.headers['content-disposition'], undefined);
	await until(
		() => fileHandles(f.logPath),
		(handles) => handles.length === 0,
		'export file descriptor released',
	);
	assert.equal((await fs.readFile(f.logPath, 'utf8')).includes('B10 export original'), true);
});

await test('Suspended export reserves both original slots while renderer completion is pending', async (t) => {
	const release = gate();
	t.after(() => release.release());
	const f = await fixture(t);
	const started = holdRenderer(t, release);
	const first = send(f.address, f.cookie, 'GET', f.path);
	const second = send(f.address, f.cookie, 'GET', f.path);
	await until(started, (count) => count === 2, 'both actual render operations entered');
	const refused = await send(f.address, f.cookie, 'GET', f.path);
	expectStatus(refused, 429);
	assert.deepEqual(refused.body, { code: 'limit_exceeded' });
	assert.equal(started(), 2, 'overflow does not open another renderer');
	release.release();
	for (const result of await Promise.all([first, second])) {
		expectStatus(result, 200);
		assert.equal(result.headers['content-type'], 'text/plain; charset=utf-8');
		assert.match(result.headers['content-disposition'], /attachment; filename="[a-f0-9-]+\.txt"/u);
		assert.match(result.bytes.toString('utf8'), /B10 export original/u);
	}
	await until(
		() => send(f.address, f.cookie, 'GET', f.path),
		(result) => result.status === 200,
		'export slots released after the original final authorization and source cleanup',
	);
	await until(
		() => fileHandles(f.logPath),
		(handles) => handles.length === 0,
		'all export descriptors released',
	);
});

await test('A disconnected HTTP export waits for its real renderer then releases without deleting the log', async (t) => {
	const release = gate();
	t.after(() => release.release());
	const f = await fixture(t);
	const openText = WorkspaceHistoryModel.prototype.openText;
	let released = 0;
	t.mock.method(WorkspaceHistoryModel.prototype, 'openText', async function (...args) {
		const source = await openText.apply(this, args);
		return {
			bytes: source.bytes,

			async release() {
				await source.release();
				released += 1;
			},
		};
	});
	const started = holdRenderer(t, release);
	const req = request('http://' + f.address + f.path, {
		headers: { Host: new URL(origin).host, Origin: origin, Cookie: f.cookie },
	});
	const closed = new Promise((resolve) => req.once('close', resolve));
	req.on('error', () => undefined);
	req.end();
	t.after(() => req.destroy());
	await until(started, (count) => count === 1, 'renderer entered before client disconnect');
	req.destroy();
	await closed;
	assert.equal(released, 0, 'the actual renderer remains owned after the client disconnects');
	release.release();
	await until(
		() => released,
		(count) => count === 1,
		'late renderer result is actually released by its owner',
	);
	await until(
		() => fileHandles(f.logPath),
		(handles) => handles.length === 0,
		'late export input released',
	);
	expectStatus(await send(f.address, f.cookie, 'GET', f.path), 200);
	assert.equal((await fs.readFile(f.logPath, 'utf8')).includes('B10 export original'), true);
});
