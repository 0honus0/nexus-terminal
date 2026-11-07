/** Shared tool payload budgets also apply to managed plugin results. */
import { AGENT_TOOL_ARGUMENT_MAX_BYTES, AGENT_TOOL_RESULT_MAX_BYTES } from '@nexus-terminal/shared/agent/tools/values';
import { AGENT_PLUGIN_HOST_ARGUMENT_MAX_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import type { AgentToolIdentity } from '@nexus-terminal/shared/agent/tools/identity';

export const TOOL_ARGUMENT_MAX_BYTES = AGENT_TOOL_ARGUMENT_MAX_BYTES;

/** Host canonical parameters are still constrained by the full RPC envelope at transport admission. */
export function toolArgumentMaxBytes(identity: AgentToolIdentity): number {
	return identity.kind === 'host' ? AGENT_PLUGIN_HOST_ARGUMENT_MAX_BYTES : TOOL_ARGUMENT_MAX_BYTES;
}

export const TOOL_RESULT_MAX_BYTES = AGENT_TOOL_RESULT_MAX_BYTES;

export const TOOL_PROVIDER_CALL_ID_MAX_BYTES = 256;
