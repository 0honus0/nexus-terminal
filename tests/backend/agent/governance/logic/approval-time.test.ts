import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { readAgentApprovalView } from '../../../../../packages/shared/src/agent/governance/http-codec';
import { toOperationApproval } from '../../../../../packages/backend/src/modules/agent/interfaces/http/operation-approval-mapper';
import type { OperationApproval } from '../../../../../packages/backend/src/modules/agent/governance/model/operation-approval-types';

function approval(): OperationApproval {
	return {
		id: randomUUID(),
		sequence: 1,
		appId: randomUUID(),
		runId: randomUUID(),
		operationId: randomUUID(),
		parentOperationId: null,
		operationName: 'shell.execute',
		operationHash: 'a'.repeat(64),
		status: 'requested',
		policyRevision: 1,
		version: 1,
		capability: 'shell.execute',
		risk: 'control',
		summary: 'Execute approved command',
		targetId: 1,
		requestedAt: 100100,
		expiresAt: 100900,
		decidedAt: null,
		decidedBy: null,
		consumedAt: null,
	};
}

test.each(['requested', 'approved', 'denied', 'expired', 'superseded'] as const)(
	'approval %s retains legal millisecond ordering when projected into one Unix second',
	(status) => {
		const source = approval();
		source.status = status;
		if (status !== 'requested') {
			source.decidedAt = 100400;
			source.decidedBy = 1;
		}
		if (status === 'approved') source.consumedAt = 100800;
		const wire = toOperationApproval(source);
		expect(wire.requestedAt).toBe(100);
		expect(wire.expiresAt).toBe(100);
		expect(readAgentApprovalView(wire)).toEqual(wire);
	},
);

test('approval decoding still rejects reversed seconds and inconsistent status evidence', () => {
	const wire = toOperationApproval(approval());
	for (const changes of [
		{ expiresAt: 99 },
		{ status: 'approved' },
		{ decidedAt: 100 },
		{ decidedByUserId: 1 },
		{ consumedAt: 100 },
	]) {
		expect(() => readAgentApprovalView({ ...wire, ...changes })).toThrow();
	}
	const approved = { ...wire, status: 'approved', decidedAt: 100, decidedByUserId: 1 };
	expect(readAgentApprovalView(approved)).toEqual(approved);
	for (const changes of [{ decidedAt: 99 }, { decidedAt: 101 }, { consumedAt: 99 }, { consumedAt: 101 }]) {
		expect(() => readAgentApprovalView({ ...approved, ...changes })).toThrow();
	}
});

test('a decision and dispatch within the expiry second retain the earlier request', () => {
	const source = approval();
	source.requestedAt = 99100;
	source.status = 'approved';
	source.decidedAt = 100400;
	source.decidedBy = 1;
	source.consumedAt = 100800;
	const wire = toOperationApproval(source);
	expect(wire.requestedAt).toBe(99);
	expect(wire.decidedAt).toBe(wire.expiresAt);
	expect(wire.consumedAt).toBe(wire.expiresAt);
	expect(readAgentApprovalView(wire)).toEqual(wire);
});
