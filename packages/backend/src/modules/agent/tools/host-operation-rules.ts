import { readAgentPluginHostOperationRequestFor } from '@nexus-terminal/shared/agent/plugins/host-operations-codec';
import type { AgentCapability, AgentApprovalRisk } from '@nexus-terminal/shared/agent/governance/values';
import type { AgentPluginHostOperationName } from '@nexus-terminal/shared/agent/plugins/values';
import type { HostOperationDefinition } from './model/tool-types.js';

type Policy = readonly [
	AgentPluginHostOperationName,
	AgentCapability,
	AgentApprovalRisk,
	boolean,
	'parallel' | 'exclusive',
	boolean,
	(readonly AgentCapability[])?,
	('inherit' | 'root-only')?,
];

/** Fixed Host resource policy; installed code may narrow access, never replace these facts. */
const POLICIES: readonly Policy[] = [
	['discovery.catalog', 'context.read', 'read', false, 'parallel', false],
	['discovery.activate', 'context.read', 'read', false, 'parallel', false],
	['targets.list', 'machine.inspect', 'read', false, 'exclusive', false],
	['diagnostics.host', 'host.inspect', 'read', false, 'parallel', false],
	['diagnostics.readTarget', 'machine.inspect', 'read', false, 'parallel', true],
	['skills.catalog', 'context.read', 'read', false, 'exclusive', false],
	['skills.read', 'context.read', 'read', false, 'exclusive', false],
	['images.list', 'context.read', 'read', false, 'parallel', false],
	['images.generate', 'artifacts.write', 'mutate', true, 'exclusive', false],
	['context.readResults', 'context.read', 'read', false, 'parallel', false],
	['artifacts.checkCapacity', 'artifacts.write', 'read', false, 'parallel', false],
	['artifacts.create', 'artifacts.write', 'mutate', true, 'exclusive', false],
	['artifacts.read', 'artifacts.read', 'read', false, 'exclusive', false],
	['artifacts.present', 'artifacts.read', 'read', false, 'parallel', false],
	['memory.propose', 'memory.propose', 'mutate', true, 'exclusive', false],
	['memory.retrieve', 'memory.read', 'read', false, 'exclusive', false],
	['project.bindingRead', 'file.read', 'read', false, 'exclusive', true],
	['project.bindingWrite', 'file.read', 'control', true, 'exclusive', true],
	['remote.readTextPage', 'file.read', 'read', false, 'parallel', true],
	['remote.listPage', 'file.read', 'read', false, 'parallel', true],
	['remote.inspect', 'file.read', 'read', false, 'parallel', true],
	['remote.search', 'file.read', 'read', false, 'parallel', true],
	['remote.write', 'file.write', 'mutate', true, 'exclusive', true],
	['remote.patch', 'file.write', 'mutate', true, 'exclusive', true],
	['remote.move', 'file.write', 'mutate', true, 'exclusive', true],
	['remote.delete', 'file.delete', 'destructive', true, 'exclusive', true],
	['remote.deliver', 'file.read', 'mutate', true, 'exclusive', true, ['artifacts.write']],
	['shell.execute', 'shell.execute', 'destructive', true, 'exclusive', true],
	['shell.jobs', 'shell.execute', 'read', false, 'exclusive', true],
	['docker.inspect', 'machine.docker.manage', 'read', false, 'parallel', true],
	['docker.control', 'machine.docker.manage', 'mutate', true, 'exclusive', true],
	['browser.catalog', 'browser.read', 'read', false, 'exclusive', false],
	['browser.open', 'browser.interact', 'control', true, 'exclusive', false],
	['browser.close', 'browser.interact', 'control', true, 'exclusive', false],
	['browser.snapshot', 'browser.read', 'read', false, 'exclusive', false],
	['browser.screenshot', 'browser.read', 'read', false, 'exclusive', false, ['artifacts.write']],
	['browser.console', 'browser.read', 'read', false, 'exclusive', false],
	['browser.navigate', 'browser.interact', 'control', true, 'exclusive', false],
	['browser.back', 'browser.interact', 'control', true, 'exclusive', false],
	['browser.scroll', 'browser.interact', 'control', true, 'exclusive', false],
	['browser.press', 'browser.interact', 'control', true, 'exclusive', false],
	['browser.select', 'browser.interact', 'control', true, 'exclusive', false],
	['browser.wait', 'browser.read', 'read', false, 'exclusive', false],
	['browser.click', 'browser.interact', 'control', true, 'exclusive', false],
	['browser.type', 'browser.interact', 'control', true, 'exclusive', false],
	['browser.upload', 'browser.interact', 'control', true, 'exclusive', false, ['artifacts.read']],
	['browser.download', 'browser.read', 'read', false, 'exclusive', false, ['artifacts.write']],
	['collaboration.delegate', 'app.intents.exchange', 'control', true, 'exclusive', false, [], 'root-only'],
	['collaboration.list', 'app.intents.exchange', 'read', false, 'exclusive', false],
	['collaboration.readOutput', 'app.intents.exchange', 'read', false, 'exclusive', false],
	['collaboration.join', 'app.intents.exchange', 'read', false, 'exclusive', false, [], 'root-only'],
	['collaboration.cancel', 'app.intents.exchange', 'control', true, 'exclusive', false, [], 'root-only'],
	['collaboration.sendMessage', 'app.intents.exchange', 'control', true, 'exclusive', false],
	['collaboration.readMessages', 'app.intents.exchange', 'read', false, 'exclusive', false],
	['collaboration.consumeMessages', 'app.intents.exchange', 'control', true, 'exclusive', false],
	['collaboration.readFact', 'app.intents.exchange', 'read', false, 'exclusive', false],
	['collaboration.writeFact', 'app.intents.exchange', 'control', true, 'exclusive', false],
];

export type GovernedHostOperationDefinition = HostOperationDefinition & { name: AgentPluginHostOperationName };

export function hostOperationDefinitions(): GovernedHostOperationDefinition[] {
	return POLICIES.map(([name, capability, risk, mutation, scheduling, targets, capabilities, childAccess]) => ({
		name,
		version: '1',
		identity: { kind: 'host', operation: name },
		capability,
		risk,
		mutation,
		scheduling,
		requirements: { capabilities: capabilities?.map((entry) => entry) ?? [], targets },
		childAccess: childAccess ?? 'inherit',
	}));
}

export function hostOperationDefinition(name: string): GovernedHostOperationDefinition | null {
	return hostOperationDefinitions().find((entry) => entry.name === name) ?? null;
}

export function isAcpExecutionOperation(name: string): boolean {
	return name === 'acp.execute' || name === 'acp.executeSaved';
}

/** The same strictly decoded request fixes risk at preparation and at persistent relationship checks. */
export function effectiveHostOperationPolicy(
	name: string,
	argumentsJson: string,
): GovernedHostOperationDefinition | null {
	const policy = hostOperationDefinition(name);
	if (!policy) {
		return null;
	}
	try {
		const raw: unknown = JSON.parse(argumentsJson);
		const request = readAgentPluginHostOperationRequestFor(policy.name, raw);
		if (request.operation === 'docker.control' && request.items.some((item) => item.action === 'remove')) {
			policy.risk = 'destructive';
		}
		if (request.operation === 'shell.jobs' && request.action === 'cancel') {
			policy.risk = 'control';
			policy.mutation = true;
		}
		return policy;
	} catch {
		return null;
	}
}
