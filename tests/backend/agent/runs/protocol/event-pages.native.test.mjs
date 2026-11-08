import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { openPlugins } from '../../plugins/support/plugin-management-fixture.mjs';
import { expectStatus, until } from '../../../../support/protocols/openssh-fixture.mjs';
import { AGENT_RUN_EVENT_TYPES } from '../../../../../packages/shared/dist/agent/runs/values.js';

await test('Run event HTTP pages preserve creation replay, cursor ownership and revoked authentication', async (t) => {
	const closing = [];
	t.after(async () => {
		const outcomes = await Promise.allSettled(closing.map((close) => Promise.resolve().then(close)));
		const failures = outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : []));
		if (failures.length) throw new AggregateError(failures, 'Run event fixture did not drain');
	});
	const host = await openPlugins((close) => closing.push(close));
	const plugin = await host.install('run-events', { frontend: false });
	await plugin.grants(['plugin.invoke']);
	const settings = expectStatus(await host.api('GET', '/api/v1/agent/execution-settings'), 200).settings;
	expectStatus(
		await host.api('PUT', '/api/v1/agent/execution-settings', {
			expectedVersion: settings.version,
			enabled: true,
			limits: settings.limits,
		}),
		200,
	);
	const thread = expectStatus(await host.api('POST', plugin.appPath + '/threads', { title: 'Event pages' }), 201);
	const path = plugin.appPath + '/threads/' + thread.id + '/runs';
	const input = { prompt: 'Complete without a model', approvalMode: 'ask', connectionIds: [], inputJson: '{}' };
	const headers = { 'Idempotency-Key': randomUUID() };
	const created = expectStatus(await host.api('POST', path, input, headers), 201);
	assert.equal(created.status, 'created');
	const runPath = plugin.appPath + '/runs/' + created.run.id;
	const initialPage = expectStatus(await host.api('GET', runPath + '/events?after=0&limit=1'), 200);
	assert.deepEqual(
		initialPage.items.map((event) => event.type),
		['run.created'],
	);
	await until(
		async () => expectStatus(await host.api('GET', runPath), 200).status,
		(status) => status === 'completed',
		'Deterministic App completion',
	);
	const events = [];
	let cursor = 0;
	for (;;) {
		const page = expectStatus(await host.api('GET', runPath + '/events?after=' + cursor + '&limit=1'), 200);
		if (!page.items.length) {
			assert.equal(page.nextCursor, cursor);
			break;
		}
		assert.equal(page.items.length, 1);
		const [event] = page.items;
		assert.equal(event.runId, created.run.id);
		assert.ok(event.sequence > cursor);
		assert.ok(AGENT_RUN_EVENT_TYPES.includes(event.type));
		assert.equal(page.nextCursor, event.sequence);
		events.push(event);
		cursor = page.nextCursor;
	}
	assert.deepEqual(
		events.map((event) => event.type),
		['run.created', 'run.started', 'run.completed'],
	);
	assert.equal(new Set(events.map((event) => event.sequence)).size, events.length);
	const replay = expectStatus(await host.api('POST', path, input, headers), 200);
	assert.deepEqual(replay, { status: 'replayed', originalStatus: 'created', run: created.run });
	assert.deepEqual(expectStatus(await host.api('GET', runPath + '/events?after=' + cursor + '&limit=1'), 200), {
		items: [],
		nextCursor: cursor,
	});
	for (const query of ['after=-1', 'after=01', 'after=0&after=0', 'limit=0', 'limit=101', 'cursor=0']) {
		assert.deepEqual(expectStatus(await host.api('GET', runPath + '/events?' + query), 400), {
			code: 'invalid_input',
		});
	}
	assert.deepEqual(
		expectStatus(
			await host.api('GET', '/api/v1/agent/apps/' + randomUUID() + '/runs/' + created.run.id + '/events'),
			404,
		),
		{ code: 'not_found' },
	);
	expectStatus(await host.api('POST', '/api/v1/auth/logout', {}), 200);
	assert.deepEqual(expectStatus(await host.api('GET', runPath + '/events?after=0&limit=1'), 401), {
		code: 'unauthenticated',
	});
});
