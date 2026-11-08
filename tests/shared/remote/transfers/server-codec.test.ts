import { test, expect } from 'vitest';
import {
	readServerTransferInput,
	readServerTransferSnapshot,
} from '../../../../packages/shared/src/remote/transfers/server-codec';

test('server-transfer decoding accepts sources beyond 1024 and targets beyond 64 with matching task indices', async () => {
	const input = readServerTransferInput({
		sourceConnectionId: 1,
		connectionIds: [2],
		sourceItems: Array.from({ length: 1025 }, (_, index) => ({
			name: 'f' + index,
			path: '/f' + index,
			type: 'file',
		})),
		remoteTargetPath: '/',
		transferMethod: 'auto',
	});
	expect(input.sourceItems).toHaveLength(1025);
	const snapshot = readServerTransferSnapshot({
		taskId: crypto.randomUUID(),
		status: 'queued',
		createdAt: 1,
		updatedAt: 1,
		overallProgress: 0,
		payload: input,
		subTasks: input.sourceItems.map((_, sourceItemIndex) => ({
			subTaskId: crypto.randomUUID(),
			connectionId: 2,
			sourceItemIndex,
			status: 'queued',
			progress: 0,
			error: null,
			transferMethodUsed: null,
		})),
	});
	expect(snapshot.subTasks.at(-1)?.sourceItemIndex).toBe(1024);
	expect(
		readServerTransferInput({
			...input,
			sourceItems: [input.sourceItems[0]],
			connectionIds: Array.from({ length: 65 }, (_, index) => index + 2),
		}).connectionIds,
	).toHaveLength(65);
	expect(() =>
		readServerTransferInput({
			...input,
			sourceItems: input.sourceItems.slice(0, 200),
			connectionIds: Array.from({ length: 200 }, (_, index) => index + 2),
		}),
	).toThrow();
	// Index validation remains tied to the actual sources, rather than an old global count.
	expect(() =>
		readServerTransferSnapshot({
			...snapshot,
			subTasks: snapshot.subTasks.map((item, index) => ({
				...item,
				sourceItemIndex: index === 1024 ? 1025 : index,
			})),
		}),
	).toThrow();
});
