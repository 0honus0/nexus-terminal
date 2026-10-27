/** Private journal budgets; public summary budgets belong to their Shared protocol. */
import { AGENT_TOOL_ARGUMENT_MAX_BYTES } from '@nexus-terminal/shared/agent/tools/values';

export const TOOL_ARGUMENT_MAX_BYTES = AGENT_TOOL_ARGUMENT_MAX_BYTES;

export const TOOL_RESULT_MAX_BYTES = 256 * 1024;

export const TOOL_PROVIDER_CALL_ID_MAX_BYTES = 256;

/** Private per-step proposal bound; does not grant an execution budget. */
export const TOOL_PROPOSAL_MAX_COUNT = 32;
