export const AGENT_PLUGIN_RUNTIME_STATES = ['opening', 'active', 'closed', 'unknown'] as const;

export type AgentPluginRuntimeState = (typeof AGENT_PLUGIN_RUNTIME_STATES)[number];
