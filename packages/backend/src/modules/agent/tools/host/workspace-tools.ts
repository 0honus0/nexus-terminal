import type { JsonValue } from '../../agent.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type {
  AgentTool,
  ToolContext,
  ToolInspection,
  ToolPrecondition,
  ToolResult,
} from '../../capabilities/tool.types';
import type { WorkspaceRuntimeGatewayPort } from '../../workspace-runtime/workspace-runtime-gateway.port';
import type { AgentWorkspaceRepositoryPort } from '../../workspace-runtime/workspace-runtime.repository.port';

const MAX_ARGV_ITEMS = 128;
const MAX_ARG_BYTES = 8 * 1024;
const MAX_TOTAL_ARG_BYTES = 64 * 1024;

const record = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};

const onlyKeys = (value: Record<string, JsonValue>, allowed: readonly string[]): void => {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) throw new Error('TOOL_ARGUMENTS_INVALID');
};

const stringValue = (value: JsonValue | undefined, maxBytes: number): string => {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value;
};

const positiveInteger = (value: JsonValue | undefined, fallback?: number): number => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as number;
};

const argvValue = (value: JsonValue | undefined): string[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ARGV_ITEMS) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  let total = 0;
  const result = value.map((item) => {
    if (typeof item !== 'string' || item.includes('\0')) throw new Error('TOOL_ARGUMENTS_INVALID');
    const bytes = Buffer.byteLength(item, 'utf8');
    if (bytes > MAX_ARG_BYTES) throw new Error('TOOL_ARGUMENTS_INVALID');
    total += bytes;
    return item;
  });
  if (total > MAX_TOTAL_ARG_BYTES) throw new Error('TOOL_ARGUMENTS_INVALID');
  return result;
};

const operationHash = (
  cryptoHash: CryptoHashPort,
  context: ToolContext,
  target: ToolInspection['target'],
  normalizedArguments: JsonValue,
  resourceKeys: string[],
  preconditions: ToolPrecondition[],
  policyRevision: number,
): string =>
  hashOperation(
    {
      schemaVersion: 2,
      scope: {
        userId: context.userId,
        appId: context.appId,
        runId: context.runId,
        agentRuntimeId: context.agentRuntimeId,
      },
      tool: { name: 'workspace_execute_argv', version: '1.0.0' },
      target: {
        kind: target.kind,
        targetIdentity: target.targetIdentity,
        endpoint: target.endpoint,
        loginUser: target.loginUser,
        configurationHash: target.configurationHash,
        workspaceId: target.workspaceId ?? null,
        generation: target.generation ?? null,
      },
      arguments: normalizedArguments,
      resourceKeys: [...resourceKeys].sort(),
      preconditions: preconditions.map((precondition) => ({
        kind: precondition.kind,
        key: precondition.key,
        observedValue: precondition.observedValue,
      })),
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    },
    cryptoHash,
  );

export const createWorkspaceJobTool = (
  repository: AgentWorkspaceRepositoryPort,
  gateway: WorkspaceRuntimeGatewayPort,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'workspace_execute_argv',
    version: '1.0.0',
    description:
      'Execute an explicit argv command inside an already-running Nexus Agent Workspace generation. Does not invoke a shell. Requires user approval.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspaceId: { type: 'string', minLength: 1, maxLength: 128 },
        argv: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_ARGV_ITEMS,
          items: { type: 'string', maxLength: MAX_ARG_BYTES },
        },
        cwd: { type: 'string', minLength: 1, maxLength: 4096 },
        timeoutSeconds: { type: 'integer', minimum: 1, maximum: 300 },
      },
      required: ['workspaceId', 'argv'],
    },
    riskClass: 'mutate',
    capability: 'workspace.runtime.execute',
  },
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['workspaceId', 'argv', 'cwd', 'timeoutSeconds', 'generation']);
    const workspaceId = stringValue(args.workspaceId, 128);
    const argv = argvValue(args.argv);
    const cwd = args.cwd === undefined ? '/workspace/work' : stringValue(args.cwd, 4096);
    const timeoutSeconds = positiveInteger(
      args.timeoutSeconds,
      Math.min(300, Math.max(1, context.deadlineAt - Math.floor(Date.now() / 1000))),
    );
    const workspace = await repository.getWorkspace(context, workspaceId);
    if (!workspace) throw new Error('NOT_FOUND');
    if (workspace.runId !== context.runId || workspace.agentRuntimeId !== context.agentRuntimeId) {
      throw new Error('RESOURCE_FORBIDDEN');
    }
    if (workspace.status !== 'running') throw new Error('WORKSPACE_NOT_RUNNING');

    const target: ToolInspection['target'] = {
      kind: 'workspace',
      workspaceId,
      generation: workspace.generation,
      targetIdentity: `workspace:${workspaceId}:${workspace.generation}`,
      endpoint: `workspace:${workspaceId}`,
      loginUser: 'runner:65532',
      configurationHash: hashOperation(
        {
          schemaVersion: 2,
          workspaceId,
          generation: workspace.generation,
          profile: JSON.parse(JSON.stringify(workspace.profile)) as JsonValue,
        },
        cryptoHash,
      ),
    };
    const normalizedArguments: JsonValue = {
      workspaceId,
      generation: workspace.generation,
      argv,
      cwd,
      timeoutSeconds,
    };
    const resourceKeys = [`workspace:${workspaceId}:${workspace.generation}`];
    const preconditions: ToolPrecondition[] = [
      {
        kind: 'workspaceGeneration',
        key: workspaceId,
        observedValue: { generation: workspace.generation, version: workspace.version, status: workspace.status },
      },
    ];
    return {
      toolName: 'workspace_execute_argv',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: 'mutate',
      mutation: true,
      operationHash: operationHash(
        cryptoHash,
        context,
        target,
        normalizedArguments,
        resourceKeys,
        preconditions,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions,
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context): Promise<ToolResult> => {
    const args = record(inspection.normalizedArguments);
    const workspaceId = stringValue(args.workspaceId, 128);
    const generation = positiveInteger(args.generation);
    const argv = argvValue(args.argv);
    const timeoutSeconds = positiveInteger(args.timeoutSeconds);
    const maxBytes = Math.max(1, Math.min(512 * 1024, Math.floor(context.maxOutputBytes / 2)));
    const job = await gateway.invoke(
      { workspaceId, generation },
      {
        operationHash: inspection.operationHash,
        argv,
        cwd: stringValue(args.cwd, 4096),
        maxBytes,
        timeoutMs: timeoutSeconds * 1000,
      },
      context.signal,
    );

    if (job.status === 'unknown' || job.status === 'pending' || job.status === 'running') {
      return {
        ok: false,
        summary: 'The Workspace job outcome could not be confirmed.',
        artifactRefs: [],
        truncated: false,
        outcome: 'unknown',
        errorCode: job.error ?? 'WORKSPACE_JOB_OUTCOME_UNKNOWN',
        verification: {
          status: 'unverified',
          summary: 'Runner could not prove whether the native Workspace job completed.',
          evidenceRefs: [],
        },
      };
    }
    if (job.status === 'failed' || job.status === 'cancelled' || !job.result) {
      return {
        ok: false,
        summary: `Workspace job ${job.status}.`,
        data: { jobId: job.jobId, errorCode: job.error ?? null },
        artifactRefs: [],
        truncated: false,
        outcome: 'confirmed',
        errorCode: job.error ?? 'WORKSPACE_JOB_FAILED',
        verification: {
          status: 'failed',
          summary: 'Runner confirmed that the Workspace job did not complete successfully.',
          evidenceRefs: [],
        },
      };
    }
    const ok = job.result.exitCode === 0 && !job.result.timedOut;
    return {
      ok,
      summary: ok
        ? 'Workspace job completed successfully.'
        : job.result.timedOut
          ? 'Workspace job timed out.'
          : `Workspace job exited with code ${job.result.exitCode}.`,
      data: {
        jobId: job.jobId,
        exitCode: job.result.exitCode,
        signal: job.result.signal,
        stdout: job.result.stdout,
        stderr: job.result.stderr,
        timedOut: job.result.timedOut,
      },
      artifactRefs: [],
      truncated: job.result.truncated,
      outcome: 'confirmed',
      ...(ok ? {} : { errorCode: job.result.timedOut ? 'WORKSPACE_JOB_TIMEOUT' : 'WORKSPACE_JOB_NONZERO_EXIT' }),
      verification: {
        status: ok ? 'verified' : 'failed',
        summary: ok
          ? 'Runner confirmed a zero exit code inside the requested Workspace generation.'
          : 'Runner confirmed that the Workspace job returned a non-success result.',
        evidenceRefs: [],
      },
    };
  },
});
