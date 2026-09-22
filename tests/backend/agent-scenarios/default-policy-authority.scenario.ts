import assert from 'node:assert/strict';
import { AGENT_DEFAULTS } from '../../../packages/backend/src/modules/agent/agent-defaults';
import { LEASE_RENEW_INTERVAL_MS } from '../../../packages/backend/src/modules/agent/capabilities/lease-policy';
import { TOOL_APPROVAL_TTL_SECONDS } from '../../../packages/backend/src/modules/agent/runtime/approvals/approval-policy';
import { toolLeaseTtlSeconds } from '../../../packages/backend/src/modules/agent/runtime/execution/tool-lease-policy';

export const defaultPolicyAuthorityScenario = async () => {
  const defaults = AGENT_DEFAULTS as unknown as Record<string, unknown>;
  for (const key of [
    'approvalTtlSeconds',
    'leaseTtlSeconds',
    'leaseRenewSeconds',
    'estimateMargin',
    'maxConcurrentToolCalls',
  ] as const) {
    assert.equal(key in defaults, false, `AGENT_DEFAULTS.${key} must not remain as a dead policy authority`);
  }
  assert.deepEqual(
    Object.keys(defaults).sort(),
    ['minFreeDiskBytes', 'modelRetryCount', 'settings'],
    'AGENT_DEFAULTS top-level policy bag must contain only live runtime defaults plus settings',
  );
  assert.equal(typeof defaults.minFreeDiskBytes, 'number', 'artifact free-space default remains a live authority');
  assert.equal(typeof defaults.modelRetryCount, 'number', 'model retry count remains a live authority');
  assert.equal(
    TOOL_APPROVAL_TTL_SECONDS,
    600,
    'approval producer/validator contract keeps the established 10 minute TTL',
  );
  assert.equal(LEASE_RENEW_INTERVAL_MS, 10_000, 'all live lease renewal paths share one 10 second cadence');
  assert.equal(toolLeaseTtlSeconds(1), 30, 'Agent tool leases retain the minimum 30 second TTL');
  assert.equal(toolLeaseTtlSeconds(60), 75, 'Agent tool lease TTL remains tool timeout plus grace');
  assert.equal(toolLeaseTtlSeconds(300), 300, 'Agent tool lease TTL remains capped at 300 seconds');
  return [
    { name: 'dead_top_level_defaults', value: 0, unit: 'fields' },
    { name: 'live_top_level_defaults', value: 2, unit: 'fields' },
    { name: 'approval_ttl_authorities', value: 1, unit: 'authorities' },
    { name: 'lease_renewal_cadence_authorities', value: 1, unit: 'authorities' },
    { name: 'agent_tool_lease_policy_cases', value: 3, unit: 'cases' },
  ];
};
