import type { JsonValue } from '../../agent.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type { AgentTool, ToolContext, ToolInspection, ToolResult } from '../../capabilities/tool.types';
import type { RunSnapshotReaderPort } from '../runs/run.repository.port';
import { normalizePlanItems, type PlanItem } from './plan.types';
import type { PlanService } from './plan.service';

const asRecord = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};

export const createPlanUpdateTool = (
  plans: PlanService,
  runs: RunSnapshotReaderPort,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'plan_update',
    version: '1.0.0',
    description:
      'Create or update the user-visible plan for this Run. Plan items are durable goals/progress, not internal model/tool execution steps.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: {
          type: 'array',
          maxItems: 64,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$' },
              title: { type: 'string', minLength: 1, maxLength: 256 },
              detail: { type: ['string', 'null'], maxLength: 2048 },
              status: { type: 'string', enum: ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'] },
              dependsOn: {
                type: 'array',
                maxItems: 16,
                uniqueItems: true,
                items: { type: 'string', minLength: 1, maxLength: 64 },
              },
              evidenceRefs: {
                type: 'array',
                maxItems: 32,
                uniqueItems: true,
                items: { type: 'string', minLength: 1, maxLength: 128 },
              },
            },
            required: ['id', 'title', 'status'],
          },
        },
      },
      required: ['items'],
    },
    riskClass: 'control',
    capability: 'runs.execute',
  },
  inspect: async (input, context, policyRevision): Promise<ToolInspection> => {
    const args = asRecord(input);
    if (Object.keys(args).some((key) => !['items', 'expectedPlanRevision'].includes(key))) {
      throw new Error('TOOL_ARGUMENTS_INVALID');
    }
    const items = normalizePlanItems(args.items) as PlanItem[];
    const snapshot = await runs.snapshot(context, context.runId);
    if (!snapshot) throw new Error('NOT_FOUND');
    if (
      args.expectedPlanRevision !== undefined &&
      (!Number.isSafeInteger(args.expectedPlanRevision) || args.expectedPlanRevision !== snapshot.plan.revision)
    ) {
      throw new Error('RUN_PLAN_REVISION_CONFLICT');
    }
    const normalizedArguments: JsonValue = {
      items: items as unknown as JsonValue,
      expectedPlanRevision: snapshot.plan.revision,
    };
    const target = {
      kind: 'run' as const,
      targetIdentity: `run:${context.runId}`,
      endpoint: `run:${context.runId}:plan`,
      loginUser: `agent-runtime:${context.agentRuntimeId}`,
      configurationHash: hashOperation(
        { schemaVersion: 1, runId: context.runId, planRevision: snapshot.plan.revision },
        cryptoHash,
      ),
    };
    return {
      toolName: 'plan_update',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys: [`run:${context.runId}:plan`],
      risk: 'control',
      mutation: false,
      operationHash: hashOperation(
        {
          schemaVersion: 1,
          scope: {
            userId: context.userId,
            appId: context.appId,
            runId: context.runId,
            agentRuntimeId: context.agentRuntimeId,
          },
          tool: { name: 'plan_update', version: '1.0.0' },
          planRevision: snapshot.plan.revision,
          items: items as unknown as JsonValue,
          policyRevision,
          inputRevision: context.inputRevision,
        },
        cryptoHash,
      ),
      operationHashVersion: 1,
      preconditions: [
        { kind: 'metadata', key: `run:${context.runId}:plan`, observedValue: { revision: snapshot.plan.revision } },
      ],
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context): Promise<ToolResult> => {
    const args = asRecord(inspection.normalizedArguments);
    if (!Number.isSafeInteger(args.expectedPlanRevision)) throw new Error('TOOL_ARGUMENTS_INVALID');
    const items = normalizePlanItems(args.items);
    const plan = await plans.replace(context, context.runId, args.expectedPlanRevision as number, items);
    return {
      ok: true,
      summary: `Plan updated to revision ${plan.revision} with ${plan.items.length} item(s).`,
      data: plan as unknown as JsonValue,
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      verification: { status: 'verified', summary: 'The durable Run plan projection was updated.', evidenceRefs: [] },
    };
  },
});
