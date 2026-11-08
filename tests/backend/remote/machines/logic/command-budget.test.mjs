import assert from 'node:assert/strict';
import { test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MachineCommandModel } from '../../../../../packages/backend/src/modules/remote/machines/model/command-model.ts';
import { RemoteMachineOperationService } from '../../../../../packages/backend/src/modules/remote/machines/service/operation-service.ts';
import { MACHINE_CONNECT_MAX_TIMEOUT_MS } from '../../../../../packages/backend/src/platform/ssh/ssh-port.ts';

test('Machine execution accepts a long caller budget and independently caps SSH handshake', async () => {
	let connectBudget;
	let commandBudget;
	let closed = 0;
	const result = {
		status: 'completed',
		commands: [
			{ index: 0, status: 'completed', exitCode: 0, signal: null, stdout: 'done', stderr: '', truncated: false },
		],
	};
	const commands = new MachineCommandModel(
		{
			release: (machine) => machine.close(),

			async open(input) {
				connectBudget = input.timeoutMs;
				return {
					machine: {
						execute() {
							throw new Error('Unused transport seam');
						},

						async close() {
							closed++;
						},
					},
				};
			},
		},
		{
			async executeBatch(_executor, _commands, _cwd, _onError, options) {
				commandBudget = options.timeoutMs;
				return {
					results: [
						{ index: 0, status: 'completed', exitCode: 0, stdout: 'done', stderr: '', truncated: false },
					],
				};
			},
		},
	);
	const service = new RemoteMachineOperationService(
		null,
		null,
		commands,
		{
			async run(_id, _origin, _targets, work) {
				return work();
			},
		},
		{
			quiesce() {},

			async close() {},
		},
	);
	try {
		const value = await service.executeCommand(
			{
				operationId: randomUUID(),
				targetId: 1,
				fingerprint: 'a'.repeat(64),
				timeoutMs: 650000,
				signal: new AbortController().signal,

				async validate() {},
			},
			{ commands: [{ kind: 'argv', argv: ['true'] }], cwd: null, onError: 'stop' },
		);
		assert.deepEqual(value, result);
		assert.equal(connectBudget, MACHINE_CONNECT_MAX_TIMEOUT_MS);
		assert.ok(commandBudget > MACHINE_CONNECT_MAX_TIMEOUT_MS && commandBudget <= 650000);
		assert.equal(closed, 1);
	} finally {
		await service.close();
	}
});
