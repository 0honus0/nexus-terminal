// Frozen published database migration dependency. Not an application API.
/** Capability IDs used by the installed Agent governance HTTP endpoints. */
export const AGENT_CAPABILITIES = [
	'file.read',
	'file.write',
	'file.delete',
	'machine.inspect',
	'host.inspect',
	'shell.execute',
	'machine.docker.manage',
	'browser.read',
	'browser.interact',
	'integration.mcp.read',
	'integration.mcp.invoke',
	'integration.acp.invoke',
	'artifacts.read',
	'artifacts.write',
	'context.read',
	'context.compact',
	'memory.read',
	'memory.propose',
	'app.intents.exchange',
	'plugin.invoke',
	'plugin.configure',
	'service.transport.http',
	'service.transport.process',
] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export const AGENT_TARGET_CAPABILITIES: readonly AgentCapability[] = [
	'file.read',
	'file.write',
	'file.delete',
	'shell.execute',
	'service.transport.process',
];
