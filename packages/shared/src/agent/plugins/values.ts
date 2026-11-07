import { readComparableVersion } from '../../common/version.js';

import { AGENT_APP_MAX_RESPONSE_BYTES } from '../scope/values.js';
import { AGENT_GOVERNANCE_MAX_RESPONSE_BYTES } from '../governance/values.js';

export const AGENT_PLUGIN_MAX_BODY_BYTES = 256 * 1024;

export const AGENT_PLUGIN_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export const AGENT_PLUGIN_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

/** Existing signed archive reader budgets; publishers and Host validate the same encoded bytes and entries. */
export const AGENT_PLUGIN_MAX_MANIFEST_BYTES = 64 * 1024;

export const AGENT_PLUGIN_MAX_FILE_LIST_BYTES = 1024 * 1024;

export const AGENT_PLUGIN_MAX_PACKAGE_ENTRIES = 10000;

export const AGENT_PLUGIN_MAX_PACKAGE_FILE_BYTES = 50 * 1024 * 1024;

export const AGENT_PLUGIN_MAX_EXPANDED_BYTES = 200 * 1024 * 1024;

export const AGENT_PLUGIN_MAX_ASSET_BYTES = 16 * 1024 * 1024;

export const AGENT_PLUGIN_MAX_ENTRY_BYTES = 2048;

export const AGENT_PLUGIN_MAX_MESSAGE_BYTES = 512 * 1024;

/** Typed Host canonical argument storage ceiling; the complete RPC envelope is checked separately. */
export const AGENT_PLUGIN_HOST_ARGUMENT_MAX_BYTES = AGENT_PLUGIN_MAX_MESSAGE_BYTES;

/** Existing backend envelope headroom; page transport never reduces the underlying context capacity. */
export const AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES = AGENT_PLUGIN_MAX_MESSAGE_BYTES - 1024;

export const AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION = 4;

export const AGENT_PLUGIN_SDK_VERSION = '4';

export const AGENT_PLUGIN_PROTOCOL_VERSION = 4;

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

export type AgentPluginHostOperationName = (typeof AGENT_PLUGIN_HOST_OPERATIONS)[number];

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

export const AGENT_PLUGIN_INSTALL_INITIALIZATION_MODES = ['disabled', 'declared_grants'] as const;

export type AgentPluginInstallInitialization = (typeof AGENT_PLUGIN_INSTALL_INITIALIZATION_MODES)[number];

export const AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES =
	Math.max(AGENT_APP_MAX_RESPONSE_BYTES, AGENT_GOVERNANCE_MAX_RESPONSE_BYTES) + 1024;

export const AGENT_PLUGIN_FRONTEND_SANDBOX = 'allow-scripts allow-forms';

export type AgentPluginFrontendSandbox = typeof AGENT_PLUGIN_FRONTEND_SANDBOX;

export const AGENT_PLUGIN_RPC_TIMEOUT_MS = 30000;

/** Existing complete migration transfer budget; namespace storage has no separate key-count or total-byte quota. */
export const AGENT_PLUGIN_MAX_MIGRATION_BYTES = 52 * 1024 * 1024;

export const AGENT_PLUGIN_STAGE_STATUSES = ['staging', 'staged', 'verified', 'installed', 'failed'] as const;

export type AgentPluginStageStatus = (typeof AGENT_PLUGIN_STAGE_STATUSES)[number];

export const AGENT_PLUGIN_INSTALLATION_STATUSES = ['installed', 'draining', 'removed'] as const;

export type AgentPluginInstallationStatus = (typeof AGENT_PLUGIN_INSTALLATION_STATUSES)[number];

export const AGENT_PLUGIN_MAX_DATA_KEY_BYTES = 128;

/** Budget for the encoded JSON string within a complete single-value RPC response. */
export const AGENT_PLUGIN_MAX_DATA_VALUE_BYTES = AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES;

export function hasAgentPluginDataValueCapacity(valueJson: string): boolean {
	return new TextEncoder().encode(JSON.stringify(valueJson)).byteLength <= AGENT_PLUGIN_MAX_DATA_VALUE_BYTES;
}

export const AGENT_PLUGIN_MAX_CATALOG_BYTES = 8 * 1024 * 1024;

/** Signed package versions use canonical lowercase SemVer without build metadata. */
export function isAgentPluginVersion(value: string): boolean {
	return /^[0-9a-z.-]+$/u.test(value) && readComparableVersion(value) === value;
}

export const AGENT_PLUGIN_CONTRIBUTION_KINDS = ['app', 'tools', 'services', 'ui', 'settings', 'skills'] as const;

export type AgentPluginContributionKind = (typeof AGENT_PLUGIN_CONTRIBUTION_KINDS)[number];

export const AGENT_PLUGIN_COMPATIBILITY_REASONS = ['host_version', 'backend_sdk', 'frontend_sdk'] as const;

export type AgentPluginCompatibilityReason = (typeof AGENT_PLUGIN_COMPATIBILITY_REASONS)[number];

export const AGENT_PLUGIN_PACKAGE_INSTALLATION_STATUSES = ['installed', 'draining', 'removed', 'incompatible'] as const;

export type AgentPluginPackageInstallationStatus = (typeof AGENT_PLUGIN_PACKAGE_INSTALLATION_STATUSES)[number];
