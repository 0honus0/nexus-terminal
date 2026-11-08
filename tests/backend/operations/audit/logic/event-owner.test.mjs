import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { AuditEventOwner } from '../../../../../packages/backend/src/modules/operations/audit/service/audit-event-owner.ts';

const notice = (index) => ({
	key: 'audit-' + index,
	event: 'SETTINGS_UPDATED',
	userId: 1,
	subjectId: null,
	sourceIp: null,
	route: null,
	statusCode: null,
});

function fixture(append = async (input) => ({ record: { id: input.key, event: input.event } })) {
	const audit = { append: vi.fn(append), prune: vi.fn(async () => {}) };
	const logging = { record: vi.fn(async () => {}) };
	const notifications = { fanout: vi.fn(async () => {}), close: vi.fn(async () => {}) };
	return { owner: new AuditEventOwner(audit, logging, notifications), audit, logging, notifications };
}

test('more than 64 admitted requests remain tracked through quiesce and late audit publication', async () => {
	const gate = Promise.withResolvers();
	const f = fixture();
	let active = 0;
	const requests = Array.from({ length: 65 }, (_, index) =>
		f.owner.run(async () => {
			active++;
			await gate.promise;
			await f.owner.publish(notice(index));
		}),
	);
	const settled = Promise.allSettled(requests);
	await Promise.resolve();
	const admitted = active;
	const closing = f.owner.close();
	assert.equal(f.owner.close(), closing);
	await assert.rejects(
		f.owner.run(async () => {}),
		{ code: 'shutting_down' },
	);
	assert.equal(f.notifications.close.mock.calls.length, 0);
	gate.resolve();
	const results = await settled;
	await closing;
	assert.equal(admitted, 65);
	assert.ok(results.every((result) => result.status === 'fulfilled'));
	assert.equal(f.audit.append.mock.calls.length, 65);
	assert.equal(f.logging.record.mock.calls.length, 65);
	assert.equal(f.notifications.fanout.mock.calls.length, 65);
	assert.equal(f.notifications.close.mock.calls.length, 1);
	await assert.rejects(f.owner.publish(notice('after-close')), { code: 'shutting_down' });
});

test('more than 256 pending audit events are retained and observed before notification close', async () => {
	const gate = Promise.withResolvers();
	let active = 0;
	const f = fixture(async (input) => {
		active++;
		await gate.promise;
		return { record: { id: input.key, event: input.event } };
	});
	const publications = Array.from({ length: 257 }, (_, index) => f.owner.publish(notice(index)));
	const settled = Promise.allSettled(publications);
	await Promise.resolve();
	const admitted = active;
	const closing = f.owner.close();
	assert.equal(f.notifications.close.mock.calls.length, 0);
	gate.resolve();
	const results = await settled;
	await closing;
	assert.equal(admitted, 257);
	assert.ok(results.every((result) => result.status === 'fulfilled'));
	assert.equal(f.audit.append.mock.calls.length, 257);
	assert.equal(f.logging.record.mock.calls.length, 257);
	assert.equal(f.notifications.fanout.mock.calls.length, 257);
	assert.equal(f.notifications.close.mock.calls.length, 1);
	assert.equal(new Set(f.logging.record.mock.calls.map(([, id]) => id)).size, 257);
	assert.ok(f.audit.prune.mock.calls.length > 0);
});

test('independent observer, pruning and close failures all survive drainage', async () => {
	const f = fixture();
	const logging = new Error('logging failure');
	const notification = new Error('notification failure');
	const pruning = new Error('pruning failure');
	const closing = new Error('close failure');
	f.logging.record.mockRejectedValue(logging);
	f.notifications.fanout.mockRejectedValue(notification);
	f.audit.prune.mockRejectedValue(pruning);
	f.notifications.close.mockRejectedValue(closing);
	await assert.rejects(f.owner.publish(notice(1)), (error) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [logging, notification, pruning]);
		return true;
	});
	await assert.rejects(f.owner.close(), (error) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.errors.length, 2);
		assert.deepEqual(error.errors[0].errors, [logging, notification, pruning]);
		assert.equal(error.errors[1], closing);
		return true;
	});
	assert.equal(f.notifications.close.mock.calls.length, 1);
});

test('publication refused after event admission stops remains observable during close', async () => {
	const f = fixture();
	const entered = Promise.withResolvers();
	const release = Promise.withResolvers();
	f.notifications.close.mockImplementation(async () => {
		entered.resolve();
		await release.promise;
	});
	const closing = f.owner.close();
	await entered.promise;
	let refusal;
	try {
		await assert.rejects(f.owner.publish(notice('too-late')), (error) => {
			refusal = error;
			return error.code === 'shutting_down';
		});
	} finally {
		release.resolve();
	}
	await assert.rejects(closing, (error) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [refusal]);
		return true;
	});
	assert.equal(f.audit.append.mock.calls.length, 0);
});
