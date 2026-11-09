import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
type CapabilityCategory = 'files' | 'execution' | 'machine' | 'browser' | 'integration' | 'data';

export const CAPABILITY_GROUPS: readonly {
	id: CapabilityCategory;
	label: string;
	icon: string;
	accent: string;
}[] = [
	{
		id: 'files',
		label: 'agent.settings.apps.categoryFiles',
		icon: 'fa-solid fa-folder-tree',
		accent: 'var(--status-warning-color)',
	},
	{
		id: 'execution',
		label: 'agent.settings.apps.categoryExecution',
		icon: 'fa-solid fa-terminal',
		accent: 'var(--status-success-color)',
	},
	{
		id: 'machine',
		label: 'agent.settings.apps.categoryMachine',
		icon: 'fa-solid fa-server',
		accent: 'var(--status-info-color)',
	},
	{
		id: 'browser',
		label: 'agent.settings.apps.categoryBrowser',
		icon: 'fa-solid fa-globe',
		accent: 'var(--status-info-color)',
	},
	{
		id: 'integration',
		label: 'agent.settings.apps.categoryIntegration',
		icon: 'fa-solid fa-plug',
		accent: 'var(--link-color)',
	},
	{
		id: 'data',
		label: 'agent.settings.apps.categoryData',
		icon: 'fa-solid fa-box-archive',
		accent: 'var(--link-color)',
	},
];

export const CAPABILITY_CATEGORIES: Record<AgentCapability, CapabilityCategory> = {
	'file.read': 'files',
	'file.write': 'files',
	'file.delete': 'files',
	'machine.inspect': 'machine',
	'host.inspect': 'machine',
	'shell.execute': 'execution',
	'machine.docker.manage': 'machine',
	'browser.read': 'browser',
	'browser.interact': 'browser',
	'integration.mcp.read': 'integration',
	'integration.mcp.invoke': 'integration',
	'integration.acp.invoke': 'integration',
	'artifacts.read': 'data',
	'artifacts.write': 'data',
	'context.read': 'data',
	'context.compact': 'data',
	'memory.read': 'data',
	'memory.propose': 'data',
	'app.intents.exchange': 'data',
	'plugin.invoke': 'integration',
	'plugin.configure': 'integration',
	'service.transport.http': 'integration',
	'service.transport.process': 'execution',
};

export const CAPABILITY_ICONS: Record<AgentCapability, string> = {
	'file.read': 'fa-solid fa-file-lines',
	'file.write': 'fa-solid fa-file-pen',
	'file.delete': 'fa-solid fa-trash-can',
	'machine.inspect': 'fa-solid fa-chart-line',
	'host.inspect': 'fa-solid fa-server',
	'shell.execute': 'fa-solid fa-terminal',
	'machine.docker.manage': 'fa-brands fa-docker',
	'browser.read': 'fa-solid fa-globe',
	'browser.interact': 'fa-solid fa-arrow-pointer',
	'integration.mcp.read': 'fa-solid fa-book-open',
	'integration.mcp.invoke': 'fa-solid fa-network-wired',
	'integration.acp.invoke': 'fa-solid fa-satellite-dish',
	'artifacts.read': 'fa-solid fa-box-archive',
	'artifacts.write': 'fa-solid fa-boxes-packing',
	'context.read': 'fa-solid fa-book',
	'context.compact': 'fa-solid fa-compress',
	'memory.read': 'fa-solid fa-brain',
	'memory.propose': 'fa-solid fa-lightbulb',
	'app.intents.exchange': 'fa-solid fa-right-left',
	'plugin.invoke': 'fa-solid fa-puzzle-piece',
	'plugin.configure': 'fa-solid fa-sliders',
	'service.transport.http': 'fa-solid fa-network-wired',
	'service.transport.process': 'fa-solid fa-terminal',
};
