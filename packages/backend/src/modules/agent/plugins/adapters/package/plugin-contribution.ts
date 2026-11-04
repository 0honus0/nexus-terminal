import { readAgentPluginContribution } from '@nexus-terminal/shared/agent/plugins/agent-extension';
import { AGENT_PLUGIN_MAX_MESSAGE_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import type { StoredPluginAgentContribution } from '../../storage/plugin-package.js';

export function pluginContribution(bytes: Uint8Array): StoredPluginAgentContribution {
	if (bytes.byteLength > AGENT_PLUGIN_MAX_MESSAGE_BYTES) {
		throw new Error('Plugin contribution exceeds IPC capacity');
	}
	const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	const value = readAgentPluginContribution(raw);
	return {
		role: value.role,
		toolNames: value.toolNames === null ? null : value.toolNames.map((name) => name),
		beforeStep: value.beforeStep,
		tools: value.tools.map((tool) => ({ name: tool.name, description: tool.description })),
	};
}
