import assert from 'node:assert/strict';
import { test } from 'vitest';
import { RunExecutionOwner } from '../../../../../packages/backend/src/modules/agent/runs/service/run-execution-owner.ts';
import {
	AgentFailure,
	ToolExecutionUnknown,
	ToolCleanupFailure,
} from '../../../../../packages/backend/src/modules/agent/agent-failure.ts';

test('B10 Child waits preserve nested effect failures and independent storage uncertainty', async () => {
	const unknown = new ToolExecutionUnknown();
	const cleanup = new ToolCleanupFailure();
	const storage = new AgentFailure('operation_unknown');
	for (const failures of [[unknown], [new AggregateError([unknown, cleanup])], [unknown, storage]]) {
		let settled = false;
		const tasks = new Map(failures.map((failure, index) => [String(index), { settled: Promise.reject(failure) }]));
		tasks.set('independent', {
			settled: Promise.resolve().then(() => {
				settled = true;
			}),
		});
		await assert.rejects(RunExecutionOwner.prototype.waitChildren.call({ tasks }, [...tasks.keys()]), (error) => {
			assert.equal(settled, true);
			if (failures.includes(storage)) {
				assert.ok(error instanceof AggregateError);
				assert.deepEqual(error.errors, failures);
			} else {
				assert.ok(error instanceof ToolExecutionUnknown);
				assert.equal(error instanceof ToolCleanupFailure, failures[0] instanceof AggregateError);
				assert.deepEqual(error.cause.errors, failures);
			}
			return true;
		});
	}
});
