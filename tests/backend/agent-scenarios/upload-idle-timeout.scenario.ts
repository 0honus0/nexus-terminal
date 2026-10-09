import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { StreamUploadOperationService } from '../../../packages/backend/src/platform/operations/upload/stream-upload-operation.service';

export const uploadIdleTimeoutScenario = async () => {
	const removed: string[] = [];
	const stream = new Writable({ write: (_chunk, _encoding, callback) => callback() });
	const filesystem = {
		ensureDirectory: async () => {},

		exists: async () => false,

		removeFile: async (path: string) => {
			removed.push(path);
		},

		openWrite: async () => stream,
	};
	const service = new StreamUploadOperationService(
		{
			require: () => ({ fileSystem: async () => filesystem }),
		} as never,
		{ idleTimeoutMs: 10 },
	);
	const events: Array<{ type: string; message?: string }> = [];
	let resolveFailed!: () => void;
	const failed = new Promise<void>((resolve) => {
		resolveFailed = resolve;
	});
	await service.start(
		{
			ownerId: 'owner',
			sessionId: 'session',
			uploadId: 'idle',
			destinationPath: '/target/file.bin',
			size: 1024,
		},
		(event) => {
			events.push(event.type === 'failed' ? { type: event.type, message: event.message } : { type: event.type });
			if (event.type === 'failed') resolveFailed();
		},
	);
	assert.deepEqual(events, [{ type: 'ready' }]);
	await Promise.race([
		failed,
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error('upload idle timeout did not fire')), 500)),
	]);
	assert.deepEqual(events, [{ type: 'ready' }, { type: 'failed', message: 'Upload idle timeout expired.' }]);
	assert.equal(stream.destroyed, true);
	assert.equal(removed.filter((path) => path.endsWith('.nexus-upload-idle.part')).length, 2);
	assert.equal(await service.cancel('owner', 'idle'), false);

	return [{ name: 'upload_idle_timeout_cleanup', value: 1, unit: 'expired-upload' }];
};
