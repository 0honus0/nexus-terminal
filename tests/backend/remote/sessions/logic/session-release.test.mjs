import assert from 'node:assert/strict';
import { test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SessionTokenModel } from '../../../../../packages/backend/src/modules/remote/sessions/model/session-token-model.ts';
import { SecureSessionTokens } from '../../../../../packages/backend/src/platform/security/adapters/secure-session-tokens.ts';
import { RemoteSessionOwner } from '../../../../../packages/backend/src/modules/remote/sessions/service/session-owner.ts';
import { remoteFixture, access } from '../support/session-owner-fixture.mjs';

const deferred = () => Promise.withResolvers();

test('session release shares cleanup failures with concurrent release and shutdown', async (t) => {
	const release = deferred();
	let closeCount = 0;
	const fixture = remoteFixture(async () => {
		closeCount += 1;
		return release.promise;
	});
	const owner = new RemoteSessionOwner(
		access,
		fixture.remote,
		{ publish: async () => undefined },
		new SessionTokenModel(new SecureSessionTokens()),
	);
	const reason = new Error('fixture close failed');
	t.onTestFinished(async () => {
		release.reject(reason);
		await assert.rejects(
			owner.close(),
			(error) => error instanceof AggregateError && error.errors.includes(reason),
		);
	});
	const session = await owner.open('good', { targetId: 7, columns: 80, rows: 25, timeoutMs: 1000 });
	const first = owner.release(session.id);
	const second = owner.release(session.id);
	assert.strictEqual(first, second, 'duplicate release must share completion and failure');
	const shutdown = owner.close();
	let settled = false;
	void shutdown
		.finally(() => {
			settled = true;
		})
		.catch(() => undefined);
	await Promise.resolve();
	assert.equal(settled, false, 'shutdown must await previously started cleanup');
	release.reject(reason);
	await assert.rejects(first, (error) => error === reason);
	await assert.rejects(second, (error) => error === reason);
	await assert.rejects(shutdown, (error) => error instanceof AggregateError && error.errors.includes(reason));
	assert.equal(closeCount, 1);
	await assert.rejects(owner.release(session.id), (error) => error === reason);
	await assert.rejects(owner.closeSession('good', session.id), (error) => error === reason);
});

test('authenticated close preserves the result of a resource already released by its transport owner', async (t) => {
	let count = 0;
	const fixture = remoteFixture(async () => {
		count += 1;
	});
	const owner = new RemoteSessionOwner(
		access,
		fixture.remote,
		{ publish: async () => undefined },
		new SessionTokenModel(new SecureSessionTokens()),
	);
	t.onTestFinished(() => owner.close());
	const session = await owner.open('good', { targetId: 7, columns: 80, rows: 25, timeoutMs: 1000 });
	await owner.release(session.id);
	assert.equal(await owner.closeSession('good', session.id), true);
	await assert.rejects(owner.closeSession('bad', session.id), (error) => error.code === 'unauthenticated');
	assert.equal(await owner.closeSession('good', randomUUID()), false);
	assert.equal(count, 1);
	await owner.close();
});
