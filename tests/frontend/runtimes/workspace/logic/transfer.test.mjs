// @vitest-environment jsdom
import { test } from 'vitest';
import assert from 'node:assert/strict';

test('workspace transfer boundaries preserve lifecycle and complete controlled I/O', async () => {
	const { createTransferChannel } =
		await import('../../../../../packages/frontend/src/runtimes/workspace/adapters/capabilityAdapters.ts');
	const { createTransferController } =
		await import('../../../../../packages/frontend/src/features/transfers/state/transferController.ts');
	const { WorkspaceDispatchFailure, WorkspaceRequestFailure } =
		await import('../../../../../packages/frontend/src/runtimes/workspace/model/workspace-error-types.ts');

	const expect = (test, name) => {
		assert.ok(test, name);
	};

	const handlers = new Map();
	const closes = new Set();
	const calls = [];

	let respond = async (type) => (type.includes('cancel') ? true : { started: true });

	let generation = 0;
	const socket = {
		connected: true,

		on(type, handler) {
			const set = handlers.get(type) ?? new Set();
			set.add(handler);
			handlers.set(type, set);
			return () => set.delete(handler);
		},

		onClose(handler) {
			closes.add(handler);
			return () => closes.delete(handler);
		},

		bindRequests() {
			const original = generation;
			return async (type, input, id) => {
				if (original !== generation || !socket.connected) throw new WorkspaceDispatchFailure('not_connected');
				calls.push({ type, input, id });
				return respond(type, input, id);
			};
		},
	};
	const channel = createTransferChannel(socket, 'target_workspace');
	await channel.workspaceConnected();
	const controller = createTransferController(channel);

	const event = (type, value) => {
		for (const handler of handlers.get(type) ?? []) handler(value);
	};

	const copy = {
		kind: 'copy',
		sources: [{ scopeId: 'target_workspace', path: '/source/a' }],
		destination: { scopeId: 'target_workspace', path: '/dest' },
	};

	const entry = (path) => ({
		path,
		name: path.split('/').at(-1),
		metadata: {
			size: 1,
			uid: 1,
			gid: 1,
			mode: 0o100644,
			accessedAt: 1,
			modifiedAt: 1,
			isFile: true,
			isDirectory: false,
			isSymbolicLink: false,
		},
	});

	const done = (id, extra = {}) =>
		event('transfer.copyMove', {
			type: 'completed',
			requestId: id,
			mode: 'copy',
			sourcePaths: ['/source/a'],
			destinationPath: '/dest',
			items: [entry('/dest/a')],
			crossSession: false,
			...extra,
		});

	const state = (id) => controller.tasks.value.find((t) => t.id === id);

	try {
		const queued = await Promise.all(Array.from({ length: 65 }, () => controller.copyMove(copy)));
		expect(
			queued.every((id) => state(id).status === 'queued'),
			'65 copy tasks remain accepted until their own completion',
		);
		for (const id of queued) done(id);
		expect(
			queued.every((id) => state(id).status === 'completed'),
			'all 65 task results remain independently correlated',
		);
		const id = await controller.copyMove(copy);
		expect(state(id).status === 'queued', 'start acceptance is not completion');
		await controller.cancel(id);
		expect(state(id).status === 'cancelling', 'cancel acceptance is not cancellation completion');
		event('transfer.copyMove', { type: 'cancelled', requestId: id });
		expect((await controller.waitForTask(id)).status === 'cancelled', 'only terminal event confirms cancellation');
		done(id);
		expect(state(id).status === 'cancelled', 'late completion cannot revive terminal task');
		const unknown = await controller.copyMove(copy);
		event('transfer.copyMove', {
			type: 'failed',
			requestId: unknown,
			mode: 'copy',
			message: 'operation_unknown',
		});
		expect(
			state(unknown).status === 'unknown' && !state(unknown).error,
			'finite unknown remains visible without raw diagnostic',
		);
		const late = await controller.copyMove(copy);
		done(late, { destinationPath: '/other' });
		expect(state(late).status === 'unknown', 'wrong destination cannot confirm completion');
		const mixedBefore = calls.length;
		await controller
			.copyMove({ ...copy, sources: [...copy.sources, { scopeId: 'other_workspace', path: '/b' }] })
			.catch(() => {});
		expect(calls.length === mixedBefore, 'mixed source owners rejected before dispatch');
		const foreignBefore = calls.length;
		await controller.copyMove({ ...copy, destination: { scopeId: 'other_workspace', path: '/d' } }).catch(() => {});
		expect(calls.length === foreignBefore, 'foreign destination rejected before dispatch');
		const largeBefore = calls.length;
		await controller
			.archive({
				kind: 'compress',
				sources: copy.sources,
				destination: { scopeId: 'target_workspace', path: '/a.zip' },
				password: 'x'.repeat(1024 * 1024),
			})
			.catch(() => {});
		expect(calls.length === largeBefore, 'complete encoded budget rejects before dispatch');
		let acknowledge;
		respond = () =>
			new Promise((resolve) => {
				acknowledge = resolve;
			});
		const starting = controller.copyMove(copy);
		const earlyId = calls.at(-1).id;
		done(earlyId);
		expect(state(earlyId).status === 'queued', 'terminal event waits for admission response');
		acknowledge({ started: true });
		await starting;
		expect(state(earlyId).status === 'completed', 'early terminal publishes after valid admission');
		respond = async () => ({ started: true });
		const cross = await controller.copyMove({
			...copy,
			sources: [{ scopeId: 'source_workspace', path: '/source/a' }],
		});
		expect(calls.at(-1).input.sourceWorkspaceId === 'source_workspace', 'cross Workspace source explicitly bound');
		done(cross, { crossSession: true, sourceOwnerId: 'wrong_workspace' });
		expect(state(cross).status === 'unknown', 'wrong cross Workspace source rejected');
		const counts = await controller.copyMove(copy);
		event('transfer.copyMove', {
			type: 'progress',
			requestId: counts,
			transferredBytes: 7,
			totalBytes: 7,
			completedFiles: 3,
			totalFiles: 1,
			totalKnown: false,
		});
		expect(
			state(counts).completedFiles === 3 && state(counts).totalFiles === null && state(counts).progress === 0,
			'recursive counts are not fabricated totals',
		);
		event('transfer.copyMove', {
			type: 'progress',
			requestId: counts,
			transferredBytes: 6,
			totalBytes: 6,
			completedFiles: 3,
			totalFiles: 1,
			totalKnown: false,
		});
		expect(state(counts).status === 'unknown', 'regressing progress cannot publish');
		const archive = {
			kind: 'compress',
			sources: copy.sources,
			destination: { scopeId: 'target_workspace', path: '/a.zip' },
			format: 'zip',
		};
		const password = await controller.archive(archive);
		event('transfer.archive', {
			type: 'failed',
			requestId: password,
			operation: 'compress',
			message: 'INVALID_PASSWORD',
			code: 'INVALID_PASSWORD',
		});
		expect(
			state(password).status === 'error' && state(password).errorCode === 'INVALID_PASSWORD',
			'password rejection preserves finite code',
		);
		const warning = await controller.archive(archive);
		event('transfer.archive', {
			type: 'completed',
			requestId: warning,
			operation: 'compress',
			path: '/a.zip',
			warning: 'verified_warning',
		});
		expect(
			state(warning).status === 'partial' && state(warning).warningKind === 'archive_completed_with_warning',
			'verified warning maps to application warning',
		);
		const wrongOperation = await controller.archive(archive);
		event('transfer.archive', { type: 'cancelled', requestId: wrongOperation, operation: 'decompress' });
		expect(state(wrongOperation).status === 'unknown', 'wrong archive operation rejected');
		const invalid = await controller.copyMove(copy);
		event('transfer.copyMove', {
			type: 'failed',
			requestId: invalid,
			mode: 'copy',
			message: 'technical secret',
		});
		expect(state(invalid).status === 'unknown', 'malformed safety payload settles task as unknown');
		respond = async (type) => (type.includes('cancel') ? false : { started: true });
		const refusedCancel = await controller.copyMove(copy);
		await controller.cancel(refusedCancel);
		expect(state(refusedCancel).status === 'queued', 'rejected cancel admission restores pending state');
		done(refusedCancel);
		expect(state(refusedCancel).status === 'completed', 'completion still arrives after refused cancellation');
		respond = async () => ({ started: false });
		await controller.copyMove(copy).catch(() => {});
		expect(controller.tasks.value[0].status === 'unknown', 'malformed admission cannot become definite failure');
		respond = async () => {
			throw new WorkspaceRequestFailure('transfer.copyMove', 'invalid_input');
		};
		await controller.copyMove(copy).catch(() => {});
		expect(
			controller.tasks.value[0].status === 'error' && !controller.tasks.value[0].error,
			'finite pre-execution rejection exposes no diagnostic',
		);
		respond = async (type) => {
			if (type.includes('cancel')) throw Error('private network detail');
			return { started: true };
		};
		const lostCancel = await controller.copyMove(copy);
		await controller.cancel(lostCancel);
		expect(
			state(lostCancel).status === 'unknown' && !state(lostCancel).error,
			'lost cancellation response preserves original unknown outcome',
		);
		respond = async () => ({ started: true });
		const disconnected = await controller.copyMove(copy);
		const dispatched = calls.length;
		socket.connected = false;
		generation++;
		for (const close of closes) close();
		expect(state(disconnected).status === 'unknown', 'original disconnect settles active task unknown');
		socket.connected = true;
		await channel.workspaceConnected();
		expect(calls.length === dispatched, 'reconnection does not replay side effects');
		const disposed = await controller.archive(archive);
		channel.dispose();
		expect(state(disposed).status === 'unknown', 'adapter disposal is not remote cancellation');
		controller.dispose();
		const before = calls.length;
		await controller.copyMove(copy).catch(() => {});
		expect(calls.length === before, 'disposed controller cannot start new work');
	} finally {
		controller.dispose();
		channel.dispose();
	}
});
