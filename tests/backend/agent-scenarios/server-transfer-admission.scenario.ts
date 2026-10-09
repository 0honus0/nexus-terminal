import assert from 'node:assert/strict';
import { TransferTaskRegistry } from '../../../packages/backend/src/modules/transfers/transfer-task.registry';
import type { InitiateTransferPayload } from '../../../packages/backend/src/modules/transfers/transfers.types';

const payload: InitiateTransferPayload = {
	sourceConnectionId: 1,
	connectionIds: [2],
	sourceItems: [{ name: 'a', path: '/tmp/a', type: 'file' }],
	remoteTargetPath: '/tmp',
	transferMethod: 'auto',
};

export const serverTransferAdmissionScenario = async () => {
	const registry = new TransferTaskRegistry();
	const created = Array.from({ length: 32 }, (_, index) => registry.create(payload, index + 1));
	assert.equal(registry.metrics().activeTasks, 32);
	assert.throws(() => registry.create(payload, 99), /TRANSFER_ACTIVE_TASK_LIMIT_EXCEEDED/);

	const released = created[0]!;
	registry.setOverallStatus(released.task.taskId, 'completed');
	registry.releaseCancellation(released.task.taskId);
	assert.doesNotThrow(() => registry.create(payload, 100));

	return [{ name: 'server_transfer_global_task_admission', value: 33, unit: 'accepted-tasks' }];
};
