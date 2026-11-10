// Frozen published database migration dependency. Not an application API.
import { readComparableVersion } from '@nexus-terminal/shared/common/version';

/** Existing signed archive reader budgets; publishers and Host validate the same encoded bytes and entries. */
export const AGENT_PLUGIN_MAX_MANIFEST_BYTES = 64 * 1024;

export const AGENT_PLUGIN_MAX_ENTRY_BYTES = 2048;

export const AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION = 4;

export const AGENT_PLUGIN_HOST_OPERATIONS = [
	'discovery.catalog',
	'discovery.activate',
	'targets.list',
	'diagnostics.host',
	'diagnostics.readTarget',
	'skills.catalog',
	'skills.read',
	'images.list',
	'images.generate',
	'context.readResults',
	'artifacts.create',
	'artifacts.read',
	'artifacts.present',
	'artifacts.checkCapacity',
	'memory.propose',
	'memory.retrieve',
	'project.bindingRead',
	'project.bindingWrite',
	'remote.readTextPage',
	'remote.listPage',
	'remote.inspect',
	'remote.search',
	'remote.write',
	'remote.patch',
	'remote.move',
	'remote.delete',
	'remote.deliver',
	'shell.execute',
	'shell.jobs',
	'docker.inspect',
	'docker.control',
	'browser.catalog',
	'browser.open',
	'browser.close',
	'browser.snapshot',
	'browser.screenshot',
	'browser.console',
	'browser.navigate',
	'browser.back',
	'browser.scroll',
	'browser.press',
	'browser.select',
	'browser.wait',
	'browser.click',
	'browser.type',
	'browser.upload',
	'browser.download',
	'collaboration.delegate',
	'collaboration.list',
	'collaboration.readOutput',
	'collaboration.join',
	'collaboration.cancel',
	'collaboration.sendMessage',
	'collaboration.readMessages',
	'collaboration.consumeMessages',
	'collaboration.readFact',
	'collaboration.writeFact',
] as const;

/** Host identities also cover its internal ACP permission approval, which is never SDK-callable. */
export const AGENT_TOOL_HOST_OPERATIONS = [
	...AGENT_PLUGIN_HOST_OPERATIONS,
	'context.checkpoint',
	'acp.catalog',
	'acp.executeSaved',
	'acp.execute',
	'mcp.catalog',
	'mcp.invokeTool',
	'mcp.readResource',
	'mcp.readPrompt',
	'acp.permission',
	'plugins.invoke',
	'discovery.search',
	'project.bind',
	'project.read',
	'project.clear',
	'skills.search',
	'memory.recall',
] as const;

export type AgentToolHostOperationName = (typeof AGENT_TOOL_HOST_OPERATIONS)[number];

/** Signed package versions use canonical lowercase SemVer without build metadata. */
export function isAgentPluginVersion(value: string): boolean {
	return /^[0-9a-z.-]+$/u.test(value) && readComparableVersion(value) === value;
}
