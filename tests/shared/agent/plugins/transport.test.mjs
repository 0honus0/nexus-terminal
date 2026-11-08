import assert from 'node:assert/strict';
import { test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InvalidAgentPayload } from '../../../../packages/shared/src/agent/http-codec.ts';
import { readAgentPluginAppBinding } from '../../../../packages/shared/src/agent/plugins/http-codec.ts';
import { readAgentPluginRpcInput } from '../../../../packages/shared/src/agent/plugins/rpc-codec.ts';
import { readAgentPluginControl } from '../../../../packages/shared/src/agent/plugins/frontend-rpc-codec.ts';
import { readAgentRunStreamCommand } from '../../../../packages/shared/src/agent/runs/events.ts';
import { readAgentStreamFrame } from '../../../../packages/shared/src/agent/runs/events.ts';

test('Agent modular: App bindings preserve exact package provenance and plugin calls cannot forge host operation identity', () => {
	const reference = {
		packageId: 'test.package',
		version: '1.0.0',
		packageHash: 'a'.repeat(64),
		publisherKeyId: 'ed25519:' + 'b'.repeat(64),
	};
	const binding = {
		appId: randomUUID(),
		executionRevision: 1,
		uiRevision: 1,
		app: reference,
		dependencies: [],
		selectedRootIds: [],
		ui: structuredClone(reference),
	};
	assert.deepEqual(readAgentPluginAppBinding(binding), binding);
	for (const changed of [
		{ packageHash: 'c'.repeat(64) },
		{ publisherKeyId: 'ed25519:' + 'd'.repeat(64) },
		{ version: '1.0.1' },
	])
		assert.throws(
			() => readAgentPluginAppBinding({ ...binding, ui: { ...reference, ...changed } }),
			InvalidAgentPayload,
		);
	const request = {
		method: 'host.perform',
		params: { operation: 'remote.listPage', connectionId: 1, path: '/', after: '' },
	};
	assert.deepEqual(readAgentPluginRpcInput(request), request);
	assert.throws(
		() =>
			readAgentPluginRpcInput({ method: 'tools.invoke', params: { name: 'shell_execute', argumentsJson: '{}' } }),
		InvalidAgentPayload,
	);
	assert.throws(
		() => readAgentPluginRpcInput({ method: 'remote.listPage', params: { connectionId: 1, path: '/', after: '' } }),
		InvalidAgentPayload,
	);
	for (const changed of [
		{ ...request.params, runId: randomUUID() },
		{ ...request.params, operationId: randomUUID() },
		{ ...request.params, stepIndex: 1 },
		...['[]', 'null', '1', '"status"', '{'].map((argumentsJson) => ({ ...request.params, argumentsJson })),
	])
		assert.throws(() => readAgentPluginRpcInput({ ...request, params: changed }), InvalidAgentPayload);
});

test('Agent modular: multiplex commands bind identity, generation and exact source shape', () => {
	const cancel = { type: 'nexus.plugin.cancel', protocol: 4, nonce: randomUUID(), seq: 1, id: randomUUID() };
	assert.deepEqual(readAgentPluginControl(cancel), cancel);
	assert.deepEqual(readAgentPluginControl({ type: 'nexus.plugin.close', protocol: 4, nonce: cancel.nonce, seq: 2 }), {
		type: 'nexus.plugin.close',
		protocol: 4,
		nonce: cancel.nonce,
		seq: 2,
	});
	assert.throws(() => readAgentPluginControl({ ...cancel, seq: 0 }), InvalidAgentPayload);
	assert.throws(() => readAgentPluginControl({ ...cancel, grant: randomUUID() }), InvalidAgentPayload);
	const command = {
		type: 'subscribe',
		subscriptionId: randomUUID(),
		generation: 1,
		source: { kind: 'run-events', appId: randomUUID(), grant: randomUUID(), runId: randomUUID(), after: 0 },
	};
	assert.deepEqual(readAgentRunStreamCommand(command), command);
	for (const changed of [
		{ ...command, generation: 0 },
		{ ...command, source: { ...command.source, operationId: randomUUID() } },
		{ ...command, source: { ...command.source, after: -1 } },
		{ ...command, source: { ...command.source, kind: 'write' } },
		{ type: 'ack', subscriptionId: command.subscriptionId, generation: 1, revision: 0 },
	])
		assert.throws(() => readAgentRunStreamCommand(changed), InvalidAgentPayload);
	const frame = {
		type: 'data',
		subscriptionId: command.subscriptionId,
		generation: 1,
		revision: 1,
		value: { items: [], nextCursor: 0 },
	};
	assert.deepEqual(readAgentStreamFrame(frame), frame);
	assert.throws(() => readAgentStreamFrame({ ...frame, generation: 0 }), InvalidAgentPayload);
	assert.throws(
		() =>
			readAgentStreamFrame({
				type: 'rejected',
				subscriptionId: command.subscriptionId,
				generation: 1,
				code: 'secret technical error',
			}),
		InvalidAgentPayload,
	);
});
