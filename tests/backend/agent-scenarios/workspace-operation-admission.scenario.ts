import assert from 'node:assert/strict';
import { WorkspaceOperationsService } from '../../../packages/backend/src/modules/workspace/services/workspace-operations.service';
import { WorkspaceProtocolSession } from '../../../packages/backend/src/interfaces/websocket/workspace-protocol.session';

export const workspaceOperationAdmissionScenario = async () => {
	const transferReleases: Array<() => void> = [];
	const transfers = {
		run: async () =>
			new Promise<void>((resolve) => {
				transferReleases.push(resolve);
			}),

		cancel: async () => true,

		cancelOwner: async () => {},
	};
	const uploads = {
		prepare: async () => ({ preparedDirectories: 1 }),

		start: async (_request: unknown, emit: (event: { type: 'ready'; uploadId: string }) => void) => {
			emit({ type: 'ready', uploadId: 'upload' });
		},

		append: async () => {},

		cancel: async () => true,

		abort: async () => false,

		cancelOwner: async () => {},
	};
	const operations = new WorkspaceOperationsService(
		{
			require: () => ({ userId: 1, connectionId: 1, executionSessionId: 'execution' }),
		} as never,
		uploads as never,
		transfers as never,
		{
			compress: async () => {},

			decompress: async () => {},

			cancel: async () => false,

			cancelOwner: async () => {},
		},
		{ publish: () => {} } as never,
		{
			withMutation: async (_request: unknown, work: (signal: AbortSignal) => Promise<unknown>) =>
				work(new AbortController().signal),

			beginMutation: async () => ({
				confirm: async () => {},

				unknown: async () => {},
			}),
		} as never,
	);

	const activeTransfers = Array.from({ length: 15 }, (_, index) =>
		operations.runTransfer('workspace-a', 'workspace-a', ['/source'], '/destination', `transfer-${index}`, 'copy'),
	);
	await operations.startUpload('workspace-a', 'upload', '/destination/upload', 1);
	await assert.rejects(
		operations.runTransfer('workspace-a', 'workspace-a', ['/source'], '/destination', 'overflow', 'copy'),
		/WORKSPACE_FILE_OPERATION_CAPACITY_EXCEEDED/,
	);
	assert.equal(await operations.cancelUpload('workspace-a', 'upload'), true);
	const admittedAfterRelease = operations.runTransfer(
		'workspace-a',
		'workspace-a',
		['/source'],
		'/destination',
		'after-release',
		'copy',
	);
	assert.equal(transferReleases.length, 16);
	for (const release of transferReleases) release();
	await Promise.all([...activeTransfers, admittedAfterRelease]);

	const sent: string[] = [];
	const socket = {
		readyState: 1,
		bufferedAmount: 0,

		send: (value: unknown) =>
			sent.push(typeof value === 'string' ? value : Buffer.from(value as Uint8Array).toString()),

		close: () => {},
	};
	let releaseTerminate!: () => void;
	const terminateGate = new Promise<boolean>((resolve) => {
		releaseTerminate = () => resolve(true);
	});
	const protocol = new WorkspaceProtocolSession(
		socket as never,
		{ userId: 1, username: 'admission', clientIp: '127.0.0.1' },
		{
			terminal: {},
			suspendCoordinator: {},
			suspended: {
				onAutoTerminated: () => () => {},

				onOwnershipRevoked: () => () => {},

				terminate: async () => terminateGate,
			},
		} as never,
	);
	const inFlight = Array.from({ length: 64 }, (_, index) =>
		protocol.handleMessage(
			Buffer.from(
				JSON.stringify({
					type: 'suspend.terminate',
					requestId: `request-${index}`,
					payload: { suspendedSessionId: `session-${index}` },
				}),
			),
			false,
		),
	);
	await protocol.handleMessage(
		Buffer.from(
			JSON.stringify({
				type: 'suspend.terminate',
				requestId: 'overflow',
				payload: { suspendedSessionId: 'overflow' },
			}),
		),
		false,
	);
	const overflowResponse = sent
		.map(
			(value) =>
				JSON.parse(value) as { requestId?: string; payload?: { ok?: boolean; error?: string }; type?: string },
		)
		.find((value) => value.requestId === 'overflow');
	assert.deepEqual(overflowResponse, {
		type: 'response',
		requestId: 'overflow',
		payload: { ok: false, error: 'WORKSPACE_REQUEST_CAPACITY_EXCEEDED' },
	});
	releaseTerminate();
	await Promise.all(inFlight);
	await protocol.close();

	return [
		{ name: 'workspace_file_operation_admission', value: 16, unit: 'operations' },
		{ name: 'workspace_protocol_inflight_admission', value: 64, unit: 'requests' },
	];
};
