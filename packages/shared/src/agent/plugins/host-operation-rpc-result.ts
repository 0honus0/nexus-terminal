import type { AgentPluginHostOperationResult } from './host-operations.js';
import type { AgentPluginRpcResult } from './events.js';

/** Preserve operation/value correlation while explicitly adding the RPC discriminator. */
export function toAgentPluginHostOperationRpcResult(
	result: AgentPluginHostOperationResult,
): Extract<AgentPluginRpcResult, { method: 'host.perform' }> {
	switch (result.operation) {
		case 'discovery.catalog':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'discovery.activate':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'targets.list':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'diagnostics.host':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'diagnostics.readTarget':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'skills.catalog':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'skills.read':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'images.list':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'images.generate':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'context.readResults':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'artifacts.create':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'artifacts.read':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'artifacts.present':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'artifacts.checkCapacity':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'memory.propose':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'memory.retrieve':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'project.bindingRead':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'project.bindingWrite':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'remote.readTextPage':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'remote.listPage':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'remote.inspect':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'remote.search':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'remote.write':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'remote.patch':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'remote.move':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'remote.delete':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'remote.deliver':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'shell.execute':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'shell.jobs':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'docker.inspect':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'docker.control':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.catalog':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.open':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.close':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.snapshot':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.screenshot':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.console':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.navigate':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.back':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.scroll':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.press':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.select':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.wait':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.click':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.type':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.upload':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'browser.download':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'collaboration.delegate':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'collaboration.list':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'collaboration.readOutput':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'collaboration.join':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'collaboration.cancel':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'collaboration.sendMessage':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'collaboration.readMessages':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'collaboration.consumeMessages':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'collaboration.readFact':
			return { method: 'host.perform', operation: result.operation, value: result.value };
		case 'collaboration.writeFact':
			return { method: 'host.perform', operation: result.operation, value: result.value };
	}
}
