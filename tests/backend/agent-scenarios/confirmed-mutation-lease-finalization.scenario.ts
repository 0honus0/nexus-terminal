import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentMutationLeaseGuardAdapter } from '../../../packages/backend/src/infrastructure/agent/capabilities/agent-mutation-lease-guard.adapter';
import { SqliteLeaseRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-lease.repository';
import { SqliteRunRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { ClockPort, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { LeasePort } from '../../../packages/backend/src/modules/agent/capabilities/lease.port';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export const confirmedMutationLeaseFinalizationScenario = async () => {
  const runFault = async (fault: 'mark_settled' | 'release'): Promise<void> => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `nexus-agent-lease-finalize-${fault}-`));
    const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'lease-finalize.sqlite', nodeEnv: 'test' });
    const leases = new SqliteLeaseRepository(db);
    const stateCommit = new SqliteStateCommitAdapter(db);
    const runs = new SqliteRunRepository(db);
    const now = fault === 'mark_settled' ? 1_800_600_000 : 1_800_610_000;
    const faultScope: Scope = { userId: 1, appId: `lease-finalize-${fault}` };
    const runId = `lease-finalize-run-${fault}`;
    const runtimeId = `lease-finalize-runtime-${fault}`;
    const toolCallId = `lease-finalize-tool-${fault}`;
    const resourceKey = `connection:42:path:/tmp/${fault}`;
    const modelRef = {
      providerId: 'scenario-provider',
      modelId: 'scenario-model',
      configurationVersion: 1,
    };
    const budget = {
      maxRunSteps: 100,
      maxActiveExecutionSeconds: 3_600,
      toolTimeoutSeconds: 120,
      maxToolOutputBytes: 1_048_576,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      maxSubagentMessages: 100,
      maxSubagentMessageBytes: 1_048_576,
      contextPolicy: freezeRunContextPolicy('normal'),
      contextCompactionMode: 'balanced',
      revision: 1,
    };
    const definition = {
      schemaVersion: 1,
      agentDefinitionId: 'scenario-agent',
      requiredModelCapabilities: [],
      model: modelRef,
      modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
      rootModelRoutes: [],
      approvalMode: 'ask',
      executionMode: 'execute',
      connectionIds: [42],
      environment: null,
      policyRevision: 1,
      settingsRevision: 1,
    };
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      steps: 1,
      subagentMessages: 0,
      subagentMessageBytes: 0,
    };
    let markFailures = fault === 'mark_settled' ? 1 : 0;
    let releaseFailures = fault === 'release' ? 1 : 0;
    const faultingLeases: LeasePort = {
      acquireMany: (owner, resourceKeys, mode, ttlSeconds) => leases.acquireMany(owner, resourceKeys, mode, ttlSeconds),
      acquireResources: (owner, resources, ttlSeconds) => leases.acquireResources(owner, resources, ttlSeconds),
      renew: (leaseIds, owner, ttlSeconds) => leases.renew(leaseIds, owner, ttlSeconds),
      markMutationActive: (leaseIds, owner, operationId) => leases.markMutationActive(leaseIds, owner, operationId),
      markMutationSettled: async (leaseIds, owner, operationId) => {
        if (markFailures > 0) {
          markFailures -= 1;
          throw new Error('INJECTED_MARK_SETTLED_FAILURE');
        }
        await leases.markMutationSettled(leaseIds, owner, operationId);
      },
      release: async (leaseIds, owner) => {
        if (releaseFailures > 0) {
          releaseFailures -= 1;
          throw new Error('INJECTED_RELEASE_FAILURE');
        }
        await leases.release(leaseIds, owner);
      },
      quarantine: (owner, resourceKeys, reason, evidence, operationId) =>
        leases.quarantine(owner, resourceKeys, reason, evidence, operationId),
    };
    const guard = new AgentMutationLeaseGuardAdapter(faultingLeases, {
      nowUnixSeconds: () => now,
    } as ClockPort);

    try {
      await db.initialize();
      await db.execute(
        "INSERT INTO users (id, username, hashed_password) VALUES (1, 'lease-finalize-user', 'not-used')",
      );
      await db.execute(
        `INSERT INTO agent_apps
          (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
         VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
        [faultScope.appId, now, now],
      );
      await db.execute(
        `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
         VALUES (?, 1, ?, 'lease finalize', 'manual', ?, ?)`,
        [`thread-${fault}`, faultScope.appId, now, now],
      );
      await db.execute(
        `INSERT INTO agent_runs
          (id, user_id, app_id, thread_id, status, goal_status, verification_status,
           budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
           created_at, started_at, updated_at)
         VALUES (?, 1, ?, ?, 'running', 'in_progress', 'not_started', ?, ?,
                 '{"schemaVersion":1,"revision":0,"items":[]}', ?, 0, ?, ?, ?)`,
        [
          runId,
          faultScope.appId,
          `thread-${fault}`,
          JSON.stringify(budget),
          JSON.stringify(definition),
          JSON.stringify(usage),
          now,
          now,
          now,
        ],
      );
      await db.execute(
        `INSERT INTO agent_runtimes
          (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
           consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
         VALUES (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, ?, ?, ?)`,
        [runtimeId, runId, JSON.stringify(modelRef), `owner-${runtimeId}`, now, now],
      );
      await db.execute(
        `INSERT INTO agent_steps
          (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
           input_refs_json, output_refs_json, created_at, completed_at)
         VALUES
           (?, ?, ?, 1, 'model', 'completed', 0, '[]', '[]', ?, ?),
           (?, ?, ?, 2, 'tool', 'completed', 0, '[]', '[]', ?, ?)`,
        [`model-step-${fault}`, runId, runtimeId, now, now, `step-${fault}`, runId, runtimeId, now, now],
      );
      const confirmedResult = {
        ok: true,
        summary: 'Mutation completed exactly once.',
        data: { changed: true },
        artifactRefs: [],
        truncated: false,
        outcome: 'confirmed',
        verification: { status: 'verified', summary: 'remote state confirmed', evidenceRefs: [] },
      };
      await db.execute(
        `INSERT INTO agent_tool_calls
          (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
           provider_call_id, tool_name, tool_version,
           inspection_json, operation_hash, operation_hash_version, risk, status, result_json,
           created_at, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, 0, 1, ?, 'scenario_mutation', '1', '{}', ?, 1, 'mutate', 'succeeded', ?, ?, ?, ?)`,
        [
          toolCallId,
          runId,
          runtimeId,
          `step-${fault}`,
          `model-step-${fault}`,
          `provider-${fault}`,
          `operation-hash-${fault}`,
          JSON.stringify(confirmedResult),
          now,
          now,
          now,
        ],
      );

      const handle = await guard.acquire({
        runtimeId,
        operationId: toolCallId,
        resourceKeys: [resourceKey],
        ttlSeconds: 120,
        signal: new AbortController().signal,
        deadlineAt: now + 60,
      });
      await handle.activate();
      const finalization = await handle.confirm();
      assert.equal(finalization.ok, false);
      if (finalization.ok) throw new Error('EXPECTED_LEASE_FINALIZATION_FAILURE');
      assert.equal(finalization.reason, 'LEASE_STATE_UNCERTAIN_AFTER_MUTATION');
      assert.deepEqual(finalization.resourceKeys, [resourceKey]);

      const attention = await stateCommit.commit({
        scope: faultScope,
        runId,
        expectedRunVersion: 1,
        events: [
          {
            type: 'run.reconciliation_required',
            payload: {
              kind: 'lease_finalization',
              mutationOutcome: 'confirmed',
              toolCallId,
              resourceKeys: finalization.resourceKeys,
              reason: finalization.reason,
              errorCode: finalization.errorCode,
            },
          },
        ],
        runPatch: { needsReconciliation: true },
        now: now + 1,
      });
      assert.equal(attention.run.needsReconciliation, true);
      assert.equal(attention.run.status, 'running');
      const tool = await db.queryOne<{ status: string; result_json: string }>(
        'SELECT status, result_json FROM agent_tool_calls WHERE id = ?',
        [toolCallId],
      );
      assert.equal(tool?.status, 'succeeded');
      assert.equal((JSON.parse(tool!.result_json) as { outcome: string }).outcome, 'confirmed');

      const reconciliation = await runs.reconciliation(faultScope, runId);
      assert.equal(reconciliation.required, true);
      assert.equal(reconciliation.resources.length, 1);
      assert.equal(reconciliation.resources[0]?.resourceKey, resourceKey);
      assert.equal(reconciliation.resources[0]?.reason, 'LEASE_STATE_UNCERTAIN_AFTER_MUTATION');
      await assert.rejects(
        () => leases.acquireMany({ type: 'agent', id: runtimeId }, [resourceKey], 'write', 60),
        /RESOURCE_QUARANTINED/,
      );

      const resolved = await stateCommit.resolveRunReconciliation({
        scope: faultScope,
        runId,
        expectedRunVersion: attention.run.version,
        note: 'Lease/resource state inspected after an already-confirmed mutation.',
        resources: reconciliation.resources.map((resource) => ({
          resourceKey: resource.resourceKey,
          version: resource.version,
        })),
        now: now + 2,
      });
      assert.equal(resolved.run.needsReconciliation, false);
      const after = await runs.reconciliation(faultScope, runId);
      assert.equal(after.required, false);
      assert.equal(after.resources.length, 0);
      const nextLease = await leases.acquireMany({ type: 'agent', id: runtimeId }, [resourceKey], 'write', 60);
      assert.equal(nextLease.length, 1);
      await leases.release(
        nextLease.map((lease) => lease.id),
        { type: 'agent', id: runtimeId },
      );
      assert.equal(
        (
          await db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM agent_tool_calls WHERE run_id = ?', [
            runId,
          ])
        )?.count,
        1,
        'lease reconciliation must never replay or duplicate the confirmed mutation tool call',
      );
    } finally {
      await db.close().catch(() => undefined);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };

  await runFault('mark_settled');
  await runFault('release');
  return [
    { name: 'finalization_fault_modes', value: 2, unit: 'modes' },
    { name: 'confirmed_mutations_replayed', value: 0, unit: 'tools' },
    { name: 'resources_unblocked_after_resolve', value: 2, unit: 'resources' },
  ];
};
