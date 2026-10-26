import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import {
	readServerTransferInput,
	readServerTransferSnapshot,
} from '../../../../packages/shared/src/remote/transfers/server-codec';

test('durable mutation claims and backup validation do not reject unrelated hosts at global capacity counts', async ({}, testInfo) => {
	test.setTimeout(120_000);
	const result = await promisify(execFile)(
		process.execPath,
		[path.resolve(__dirname, '../../fixtures/remote/mutation-capacity.mjs'), testInfo.outputPath('mutation.db')],
		{ timeout: 90_000, maxBuffer: 1024 * 1024 },
	);
	expect(result.stdout).toContain(
		'Verified 4100 independent claims, snapshot integrity and endpoint conflict preservation',
	);
});

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

for (const fixture of ['workspace-upload', 'workspace-files', 'workspace-transfer']) {
	test(`frontend ${fixture} boundaries preserve lifecycle without retired count rejections`, async () => {
		test.setTimeout(120_000);
		const result = await promisify(execFile)(
			process.execPath,
			[path.resolve(__dirname, '../../../frontend/' + fixture + '.integration.mjs')],
			{ timeout: 90_000, maxBuffer: 1024 * 1024 },
		);
		expect(result.stdout).toContain('PASS');
	});
}

test('native transfer preserves stream cancellation, pinned keys and credential cleanup', async () => {
	test.setTimeout(120_000);
	const result = await promisify(execFile)(
		process.execPath,
		[
			'--test',
			'--test-name-pattern=native secret cleanup',
			path.resolve(__dirname, '../../../backend/remote/backend-next-server-transfers.integration.mjs'),
		],
		{ timeout: 90_000, maxBuffer: 1024 * 1024 },
	);
	expect(result.stdout).toContain(
		'native secret cleanup and pinned handshake evidence remain independent of execution outcome',
	);
});

test('directory copy reuses parent checks within each task and keeps exact content', async () => {
	const result = await promisify(execFile)(
		process.execPath,
		[path.resolve(__dirname, '../../fixtures/remote/copy-directory-checks.mjs')],
		{ timeout: 30_000, maxBuffer: 1024 * 1024 },
	);
	expect(result.stdout).toContain('Verified task-local parent checks and exact content across 200 file copies');
});
