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
import type {
  WorkspaceJobView,
  WorkspaceRuntimeGatewayPort,
} from '../../workspace-runtime/workspace-runtime-gateway.port';
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
  toolName: string,
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
      tool: { name: toolName, version: '1.0.0' },
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
        mode: { type: 'string', enum: ['foreground', 'background'] },
      },
      required: ['workspaceId', 'argv', 'mode'],
    },
    riskClass: 'mutate',
    capability: 'workspace.execute',
  },
  isAvailable: ({ environment }) => environment !== null,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['workspaceId', 'argv', 'cwd', 'timeoutSeconds', 'mode', 'generation']);
    const workspaceId = stringValue(args.workspaceId, 128);
    const argv = argvValue(args.argv);
    const cwd = args.cwd === undefined ? '/workspace/work' : stringValue(args.cwd, 4096);
    const timeoutSeconds = positiveInteger(
      args.timeoutSeconds,
      Math.min(300, Math.max(1, context.deadlineAt - Math.floor(Date.now() / 1000))),
    );
    const mode = stringValue(args.mode, 16);
    if (mode !== 'foreground' && mode !== 'background') throw new Error('TOOL_ARGUMENTS_INVALID');
    const workspace = await repository.getWorkspace(context, workspaceId);
    if (!workspace) throw new Error('NOT_FOUND');
    if (workspace.runId !== context.runId || workspace.agentRuntimeId !== context.agentRuntimeId) {
      throw new Error('RESOURCE_FORBIDDEN');
    }
    if (workspace.status !== 'running') throw new Error('WORKSPACE_NOT_RUNNING');

    const target: ToolInspection['target'] = {
      kind: 'workspace',
      target: 'workspace',
      id: workspaceId,
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
      mode,
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
        'workspace_execute_argv',
        context,
        target,
        normalizedArguments,
        resourceKeys,
        preconditions,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions,
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
    const mode = stringValue(args.mode, 16);
    if (mode !== 'foreground' && mode !== 'background') throw new Error('TOOL_ARGUMENTS_INVALID');
    const maxBytes = Math.max(1, Math.min(512 * 1024, Math.floor(context.maxOutputBytes / 2)));
    const call = {
      operationHash: inspection.operationHash,
      argv,
      cwd: stringValue(args.cwd, 4096),
      maxBytes,
      timeoutMs: timeoutSeconds * 1000,
    };
    const job =
      mode === 'background'
        ? await gateway.startJob({ workspaceId, generation }, call, context.signal)
        : await gateway.invoke({ workspaceId, generation }, call, context.signal);

    if (mode === 'background' && (job.status === 'pending' || job.status === 'running')) {
      return {
        ok: true,
        summary: 'Workspace background job accepted by the durable Runner job journal.',
        data: {
          jobId: job.jobId,
          workspaceId: job.workspaceId,
          generation: job.generation,
          status: job.status,
        },
        artifactRefs: [],
        truncated: false,
        outcome: 'confirmed',
        verification: {
          status: 'unverified',
          summary: 'Runner confirmed job submission, but the command has not reached a terminal result yet.',
          evidenceRefs: [],
        },
      };
    }

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

const utf8Tail = (value: string, maxBytes: number): { text: string; truncated: boolean } => {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= maxBytes) return { text: value, truncated: false };
  let start = buffer.byteLength - maxBytes;
  while (start < buffer.byteLength && (buffer[start]! & 0xc0) === 0x80) start += 1;
  return { text: buffer.subarray(start).toString('utf8'), truncated: true };
};

const workspaceJobResult = (
  job: WorkspaceJobView,
  action: 'status' | 'wait' | 'cancel',
  maxOutputBytes: number,
): ToolResult => {
  if (job.status === 'pending' || job.status === 'running') {
    return {
      ok: action !== 'cancel',
      summary:
        action === 'cancel'
          ? `Workspace job cancellation is not yet confirmed; the durable job is still ${job.status}.`
          : action === 'wait'
            ? `Workspace job is still ${job.status} after the server-side wait window.`
            : `Workspace job is ${job.status}.`,
      data: {
        jobId: job.jobId,
        workspaceId: job.workspaceId,
        generation: job.generation,
        status: job.status,
        createdAt: job.createdAt,
      },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      ...(action === 'cancel' ? { errorCode: 'WORKSPACE_JOB_CANCEL_PENDING' } : {}),
      verification: {
        status: 'unverified',
        summary: 'Runner confirmed the durable job state, but the command has not reached a terminal result.',
        evidenceRefs: [],
      },
    };
  }
  if (job.status === 'cancelled') {
    return {
      ok: action === 'cancel',
      summary: 'Runner confirmed that the Workspace job is cancelled.',
      data: {
        jobId: job.jobId,
        workspaceId: job.workspaceId,
        generation: job.generation,
        status: job.status,
        errorCode: job.error,
        completedAt: job.completedAt,
      },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      ...(action === 'cancel' ? {} : { errorCode: job.error ?? 'WORKSPACE_JOB_CANCELLED' }),
      verification: {
        status: 'failed',
        summary: 'The job reached a terminal cancelled state and therefore is not successful execution evidence.',
        evidenceRefs: [],
      },
    };
  }
  if (job.status === 'failed' || job.status === 'unknown' || !job.result) {
    return {
      ok: false,
      summary: `Workspace job is ${job.status}.`,
      data: {
        jobId: job.jobId,
        workspaceId: job.workspaceId,
        generation: job.generation,
        status: job.status,
        errorCode: job.error,
        completedAt: job.completedAt,
      },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      errorCode: job.error ?? (job.status === 'unknown' ? 'WORKSPACE_JOB_OUTCOME_UNKNOWN' : 'WORKSPACE_JOB_FAILED'),
      verification: {
        status: job.status === 'unknown' ? 'unverified' : 'failed',
        summary:
          job.status === 'unknown'
            ? 'Runner retained the durable job record but could not prove its terminal command outcome.'
            : 'Runner confirmed that the Workspace job failed.',
        evidenceRefs: [],
      },
    };
  }
  const projectedBytes = Math.max(1024, Math.min(64 * 1024, Math.floor(maxOutputBytes / 2)));
  const stdout = utf8Tail(job.result.stdout, Math.max(512, Math.floor(projectedBytes / 2)));
  const stderr = utf8Tail(job.result.stderr, Math.max(512, Math.floor(projectedBytes / 2)));
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
      workspaceId: job.workspaceId,
      generation: job.generation,
      status: job.status,
      exitCode: job.result.exitCode,
      signal: job.result.signal,
      stdoutTail: stdout.text,
      stderrTail: stderr.text,
      timedOut: job.result.timedOut,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    },
    artifactRefs: [],
    truncated: job.result.truncated || stdout.truncated || stderr.truncated,
    outcome: 'confirmed',
    ...(ok ? {} : { errorCode: job.result.timedOut ? 'WORKSPACE_JOB_TIMEOUT' : 'WORKSPACE_JOB_NONZERO_EXIT' }),
    verification: {
      status: ok ? 'verified' : 'failed',
      summary: ok
        ? 'Runner durable job state confirms a zero exit code inside the bound Workspace generation.'
        : 'Runner durable job state confirms a non-success command result.',
      evidenceRefs: [],
    },
  };
};

export const createWorkspaceJobControlTool = (
  repository: AgentWorkspaceRepositoryPort,
  gateway: WorkspaceRuntimeGatewayPort,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'workspace_job',
    version: '1.0.0',
    description:
      'Inspect, server-side wait for, or cancel one durable Workspace background job. Use wait instead of repeatedly polling status.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        jobId: { type: 'string', pattern: '^job-[a-f0-9]{64}$' },
        action: { type: 'string', enum: ['status', 'wait', 'cancel'] },
        waitSeconds: { type: 'integer', minimum: 1, maximum: 300 },
      },
      required: ['jobId', 'action'],
    },
    riskClass: 'control',
    capability: 'workspace.execute',
  },
  isAvailable: ({ environment }) => environment !== null,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['jobId', 'action', 'waitSeconds', 'workspaceId', 'generation']);
    const jobId = stringValue(args.jobId, 80);
    if (!/^job-[a-f0-9]{64}$/.test(jobId)) throw new Error('TOOL_ARGUMENTS_INVALID');
    const action = stringValue(args.action, 16);
    if (action !== 'status' && action !== 'wait' && action !== 'cancel') throw new Error('TOOL_ARGUMENTS_INVALID');
    const waitSeconds =
      action === 'wait'
        ? positiveInteger(
            args.waitSeconds,
            Math.min(300, Math.max(1, context.deadlineAt - Math.floor(Date.now() / 1000))),
          )
        : undefined;
    if (action !== 'wait' && args.waitSeconds !== undefined) throw new Error('TOOL_ARGUMENTS_INVALID');
    const job = await gateway.queryJob(jobId, context.signal);
    const workspace = await repository.getWorkspace(context, job.workspaceId);
    if (!workspace) throw new Error('NOT_FOUND');
    if (workspace.runId !== context.runId || workspace.agentRuntimeId !== context.agentRuntimeId) {
      throw new Error('RESOURCE_FORBIDDEN');
    }
    const target: ToolInspection['target'] = {
      kind: 'workspace',
      target: 'workspace',
      id: job.workspaceId,
      workspaceId: job.workspaceId,
      generation: job.generation,
      targetIdentity: `workspace:${job.workspaceId}:${job.generation}:job:${job.jobId}`,
      endpoint: `workspace:${job.workspaceId}`,
      loginUser: 'runner:65532',
      configurationHash: hashOperation(
        {
          schemaVersion: 2,
          workspaceId: job.workspaceId,
          generation: job.generation,
          jobId: job.jobId,
        },
        cryptoHash,
      ),
    };
    const normalizedArguments: JsonValue = {
      jobId,
      action,
      workspaceId: job.workspaceId,
      generation: job.generation,
      ...(waitSeconds === undefined ? {} : { waitSeconds }),
    };
    const preconditions: ToolPrecondition[] = [
      {
        kind: 'metadata',
        key: jobId,
        observedValue: {
          workspaceId: job.workspaceId,
          generation: job.generation,
          status: job.status,
        },
      },
    ];
    const resourceKeys = [`workspace-job:${jobId}`];
    return {
      toolName: 'workspace_job',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: 'control',
      mutation: false,
      operationHash: operationHash(
        cryptoHash,
        'workspace_job',
        context,
        target,
        normalizedArguments,
        resourceKeys,
        preconditions,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions,
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context): Promise<ToolResult> => {
    const args = record(inspection.normalizedArguments);
    const jobId = stringValue(args.jobId, 80);
    const workspaceId = stringValue(args.workspaceId, 128);
    const generation = positiveInteger(args.generation);
    const action = stringValue(args.action, 16) as 'status' | 'wait' | 'cancel';
    const job =
      action === 'status'
        ? await gateway.queryJob(jobId, context.signal)
        : action === 'wait'
          ? await gateway.waitJob(jobId, positiveInteger(args.waitSeconds) * 1000, context.signal)
          : await gateway.cancelJob(jobId, context.signal);
    if (job.workspaceId !== workspaceId || job.generation !== generation) throw new Error('RESOURCE_CHANGED');
    return workspaceJobResult(job, action, context.maxOutputBytes);
  },
});
