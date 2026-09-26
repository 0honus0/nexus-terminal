import assert from 'node:assert/strict';
import {
  AGENT_RUN_INPUT_ACCEPTING_STATUSES,
  AGENT_RUN_NON_TERMINAL_STATUSES,
  agentRunAcceptsInput,
  isAgentRunNonTerminal,
  type AgentRunStatusDto,
} from '../../packages/protocol/src/agent-runs';

const accepting = new Set<AgentRunStatusDto>(AGENT_RUN_INPUT_ACCEPTING_STATUSES);
const nonTerminal = new Set<AgentRunStatusDto>(AGENT_RUN_NON_TERMINAL_STATUSES);

assert.equal(nonTerminal.has('cancelling'), true);
assert.equal(accepting.has('cancelling'), false);
assert.equal(isAgentRunNonTerminal('cancelling'), true);
assert.equal(agentRunAcceptsInput('cancelling'), false);

for (const status of AGENT_RUN_INPUT_ACCEPTING_STATUSES) {
  assert.equal(isAgentRunNonTerminal(status), true, `input-accepting status ${status} must remain non-terminal`);
  assert.equal(agentRunAcceptsInput(status), true);
}

for (const status of ['completed', 'completed_unverified', 'failed', 'cancelled', 'interrupted'] as const) {
  assert.equal(isAgentRunNonTerminal(status), false);
  assert.equal(agentRunAcceptsInput(status), false);
}

console.log('agent run input-status regression: PASS');
