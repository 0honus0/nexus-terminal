import { randomUUID } from 'node:crypto';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { readServerTransferPage } from '../../../../packages/shared/src/remote/transfers/server-codec';
import type { ServerTransferSnapshot } from '../../../../packages/shared/src/remote/transfers/server-model';

const transfer = (index: number): ServerTransferSnapshot => ({
	taskId: `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
	status: 'unknown',
	createdAt: index + 1,
	updatedAt: index + 1,
	overallProgress: 0,
	payload: {
		sourceConnectionId: 1,
		connectionIds: [2],
		sourceItems: [{ name: 'seed.zip', path: '/seed.zip', type: 'file' }],
		remoteTargetPath: '/destination',
		transferMethod: 'auto',
	},
	subTasks: [
		{
			subTaskId: randomUUID(),
			connectionId: 2,
			sourceItemIndex: 0,
			status: 'unknown',
			progress: 0,
			error: 'operation_unknown',
			transferMethodUsed: 'rsync',
		},
	],
});

test('server transfer pagination reads beyond 160 records and still rejects repeated records', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	const records = Array.from({ length: 161 }, (_, index) => transfer(index));
	let repeat = false;
	const cursors: Array<string | null> = [];
	await page.route('**/api/v1/transfers/status*', async (route) => {
		const after = new URL(route.request().url()).searchParams.get('after');
		cursors.push(after);
		const offset = after === null ? 0 : records.findIndex((record) => record.taskId === after) + 1;
		const items = records.slice(offset, offset + 8);
		if (repeat && offset === 8) items[0] = records[0]!;
		const nextCursor = offset + items.length < records.length ? items.at(-1)!.taskId : null;
		await route.fulfill({ status: 200, json: readServerTransferPage({ items, nextCursor }) });
	});
	await page.goto('/connections');
	const ids = await page.evaluate(async () => {
		const modulePath = '/__e2e__/browser-clients.js';
		const {
			serverTransfersApi,
		}: typeof import('../../../../packages/frontend/src/features/transfers/api/server-transfers-api') =
			await import(modulePath);
		return (await serverTransfersApi.list()).map((record) => record.taskId);
	});
	expect(ids).toEqual(records.map((record) => record.taskId));
	expect(cursors).toHaveLength(21);
	repeat = true;
	const failure = await page.evaluate(async () => {
		const modulePath = '/__e2e__/browser-clients.js';
		const {
			serverTransfersApi,
		}: typeof import('../../../../packages/frontend/src/features/transfers/api/server-transfers-api') =
			await import(modulePath);
		try {
			await serverTransfersApi.list();
			return 'unexpected_success';
		} catch (cause) {
			return cause instanceof Error && 'code' in cause ? cause.code : 'unexpected_failure';
		}
	});
	expect(failure).toBe('protocol_failure');
});
