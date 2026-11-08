import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readAgentPluginRpcInput } from '../../../../packages/shared/src/agent/plugins/rpc-codec.ts';
import { InvalidAgentPayload } from '../../../../packages/shared/src/agent/http-codec.ts';

test('Current SDK RPC accepts settings reads and rejects caller-forged identity fields', () => {
	assert.deepEqual(readAgentPluginRpcInput({ method: 'settings.read', params: {} }), {
		method: 'settings.read',
		params: {},
	});
	for (const params of [{ appId: 'caller-scope' }, { instanceId: 'caller-instance' }, { runId: 'caller-run' }]) {
		assert.throws(() => readAgentPluginRpcInput({ method: 'settings.read', params }), InvalidAgentPayload);
	}
});

test('MCP Host contract: retired monolithic MCP Host names and forged wire identities remain unavailable', () => {
	for (const operation of ['mcp.invokeTool', 'mcp.readResource', 'mcp.readPrompt'])
		assert.throws(
			() =>
				readAgentPluginRpcInput({
					method: 'host.perform',
					params: {
						operation,
						id: '00000000-0000-4000-8000-000000000001',
						version: 1,
						schemaHash: 'a'.repeat(64),
						name: 'external-fixture',
						argumentsJson: '{}',
						resume: null,
					},
				}),
			InvalidAgentPayload,
		);
});
