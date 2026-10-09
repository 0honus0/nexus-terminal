import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { StreamUploadOperationService } from '../../../packages/backend/src/platform/operations/upload/stream-upload-operation.service';

export const uploadPrepareCacheLifecycleScenario = async () => {
	let now = 0;
	const filesystem = {
		ensureDirectory: async () => {},

		exists: async () => false,

		removeFile: async () => {},

		openWrite: async () => new Writable({ write: (_chunk, _encoding, callback) => callback() }),
	};
	const service = new StreamUploadOperationService(
		{
			require: () => ({ fileSystem: async () => filesystem }),
		} as never,
		{
			maxBatchesPerOwner: 3,
			maxDirectoriesPerOwner: 4,
			ttlMs: 100,

			now: () => now,
		},
	);

	await service.prepare({
		ownerId: 'owner',
		sessionId: 'session',
		prepareId: 'a',
		basePath: '/root',
		directories: ['a'],
	});
	await service.prepare({
		ownerId: 'owner',
		sessionId: 'session',
		prepareId: 'b',
		basePath: '/root',
		directories: ['b'],
	});
	await assert.rejects(
		service.prepare({
			ownerId: 'owner',
			sessionId: 'session',
			prepareId: 'c',
			basePath: '/root',
			directories: [],
		}),
		/Prepared upload directory capacity exceeded/,
	);

	await service.prepare({
		ownerId: 'owner',
		sessionId: 'session',
		prepareId: 'a',
		basePath: '/root',
		directories: [],
	});
	await service.prepare({
		ownerId: 'owner',
		sessionId: 'session',
		prepareId: 'c',
		basePath: '/root',
		directories: [],
	});
	await assert.rejects(
		service.prepare({
			ownerId: 'owner',
			sessionId: 'session',
			prepareId: 'd',
			basePath: '/root',
			directories: [],
		}),
		/Too many prepared upload batches/,
	);

	now = 50;

	const start = async (uploadId: string): Promise<string[]> => {
		const events: string[] = [];
		await service.start(
			{
				ownerId: 'owner',
				sessionId: 'session',
				uploadId,
				destinationPath: `/root/${uploadId}`,
				size: 1,
				prepareId: 'a',
			},
			(event) => events.push(event.type),
		);
		return events;
	};

	assert.deepEqual(await start('one'), ['ready']);
	assert.deepEqual(await start('two'), ['ready']);
	await service.cancel('owner', 'one');
	await service.cancel('owner', 'two');

	now = 101;
	await service.prepare({
		ownerId: 'owner',
		sessionId: 'session',
		prepareId: 'd',
		basePath: '/root',
		directories: [],
	});
	now = 151;
	assert.deepEqual(await start('expired'), ['failed']);

	await service.cancelOwner('owner');
	const cleanupEvents: string[] = [];
	await service.start(
		{
			ownerId: 'owner',
			sessionId: 'session',
			uploadId: 'cleaned',
			destinationPath: '/root/cleaned',
			size: 1,
			prepareId: 'd',
		},
		(event) => cleanupEvents.push(event.type),
	);
	assert.deepEqual(cleanupEvents, ['failed']);

	return [
		{ name: 'upload_prepare_cache_capacity', value: 4, unit: 'directories' },
		{ name: 'upload_prepare_batch_reuse', value: 2, unit: 'starts' },
	];
};
