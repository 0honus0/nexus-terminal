import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHash } from 'node:crypto';
import { SftpFileResource } from '../../../../../packages/backend/src/modules/remote/files/model/file-resource.ts';
import { RemoteFileFailure } from '../../../../../packages/backend/src/modules/remote/files/model/file-types.ts';
import { RemoteFileService } from '../../../../../packages/backend/src/modules/remote/files/service/file-service.ts';
import { RemoteResourceCleanupFailure } from '../../../../../packages/backend/src/modules/remote/resource-errors.ts';

const tokens = { digest: (token) => createHash('sha256').update(token).digest('hex') };
const mutations = { run: () => assert.fail('Resource-only lifecycle must not dispatch a file mutation') };

test('file resource cleanup preserves all failures and cancelled acquisition retains its late resource', async (t) => {
	const cleanupErrors = [new Error('lease cleanup failed'), new Error('machine cleanup failed')];
	const cleanupResource = new SftpFileResource(
		1,
		'f'.repeat(64),
		{
			isOpen: true,

			close: async () => Promise.reject(cleanupErrors[1]),
		},
		{ close: async () => Promise.reject(cleanupErrors[0]) },
		'fixture-server-key',
		async () => Promise.reject(cleanupErrors[1]),
	);
	const firstClose = cleanupResource.close();
	const secondClose = cleanupResource.close();
	assert.strictEqual(firstClose, secondClose);
	await assert.rejects(
		firstClose,
		(error) =>
			error instanceof RemoteResourceCleanupFailure && cleanupErrors.every((item) => error.errors.includes(item)),
	);

	let releaseLate;
	const lateOpening = new Promise((resolve) => {
		releaseLate = resolve;
	});
	let enteredLateOpen;
	const lateOpenEntered = new Promise((resolve) => {
		enteredLateOpen = resolve;
	});
	let openCount = 0;
	let lateCloseCount = 0;

	const disposable = () => ({
		targetId: 1,
		fingerprint: 'f'.repeat(64),
		isOpen: true,

		close: async () => undefined,
	});

	const lateResource = {
		...disposable(),

		close: async () => {
			lateCloseCount += 1;
		},
	};
	const model = {
		digestToken: (token) => tokens.digest(token),

		open: async () => {
			openCount += 1;
			if (openCount === 1) {
				enteredLateOpen();
				return lateOpening;
			}
			return disposable();
		},

		checkFingerprint: async () => undefined,
	};
	const access = { authenticate: async () => ({ userId: 1 }) };
	const service = new RemoteFileService(access, model, { get: async () => ({ name: 'Fixture target' }) }, mutations);
	t.onTestFinished(async () => {
		releaseLate(lateResource);
		await service.close();
	});
	const controller = new AbortController();
	const cancelled = service.open('good', 1, controller.signal);
	await lateOpenEntered;
	controller.abort();
	await assert.rejects(
		cancelled,
		(error) => error instanceof RemoteFileFailure && error.code === 'remote_unavailable',
	);
	const held = [];
	for (let index = 0; index < 7; index += 1) {
		held.push(await service.open('good', index + 2));
	}
	held.push(await service.open('good', 20));
	assert.equal(held.length, 8, 'Unrelated resource acquisition has no former eight-resource cap');
	releaseLate(lateResource);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(lateCloseCount, 1, 'late successful open must be closed by its original owner');
	held.push(await service.open('good', 21));
	await service.close();
});

test('cancelled file acquisition preserves late cleanup failure through shutdown', async (t) => {
	let enteredOpen;
	const entered = new Promise((resolve) => {
		enteredOpen = resolve;
	});
	let rejectOpen;
	const opening = new Promise((_, reject) => {
		rejectOpen = reject;
	});
	const model = {
		digestToken: (token) => tokens.digest(token),

		open: async () => {
			enteredOpen();
			return opening;
		},

		checkFingerprint: async () => undefined,
	};
	const service = new RemoteFileService(
		{ authenticate: async () => ({ userId: 1 }) },
		model,
		{
			get: async () => ({ name: 'Fixture target' }),
		},
		mutations,
	);
	const cleanup = new RemoteResourceCleanupFailure([new Error('late SFTP cleanup failed')]);
	t.onTestFinished(async () => {
		rejectOpen(cleanup);
		await assert.rejects(
			service.close(),
			(error) => error instanceof AggregateError && error.errors.includes(cleanup),
		);
	});
	const controller = new AbortController();
	const cancelled = service.open('good', 1, controller.signal);
	await entered;
	controller.abort();
	await assert.rejects(
		cancelled,
		(error) => error instanceof RemoteFileFailure && error.code === 'remote_unavailable',
	);
	rejectOpen(cleanup);
	await new Promise((resolve) => setImmediate(resolve));
	await assert.rejects(service.close(), (error) => error instanceof AggregateError && error.errors.includes(cleanup));
});
