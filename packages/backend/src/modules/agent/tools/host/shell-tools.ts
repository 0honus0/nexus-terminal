import type { JsonValue } from '../../agent.types';
import type { ShellCapabilityService, UnifiedShellCommand } from '../../capabilities/shell-capability.service';
import type { AgentTargetKind } from '../../capabilities/tool-target.types';
import type {
  AgentTool,
  ToolContext,
  ToolInspection,
  ToolPrecondition,
  ToolResult,
} from '../../capabilities/tool.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type { WorkspaceJobView } from '../../workspace-runtime/workspace-runtime-gateway.port';

const MAX_ID_BYTES = 128;
const MAX_ARGV_ITEMS = 128;
const MAX_ARG_BYTES = 8 * 1024;
const MAX_TOTAL_ARG_BYTES = 64 * 1024;
const MAX_SHELL_BYTES = 32 * 1024;
const MAX_CWD_BYTES = 4096;

const record = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};

const onlyKeys = (value: Record<string, JsonValue>, allowed: readonly string[]): void => {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) throw new Error('TOOL_ARGUMENTS_INVALID');
};

const stringValue = (value: JsonValue | undefined, maxBytes: number): string => {
  if (typeof value !== 'string' || !value || value.includes('\0') || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value;
};

const targetKind = (value: JsonValue | undefined): AgentTargetKind => {
  if (value !== 'workspace' && value !== 'ssh') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value;
};

const selectorFrom = (args: Record<string, JsonValue>) => ({
  target: targetKind(args.target),
  id: stringValue(args.id, MAX_ID_BYTES),
});

const positiveInteger = (value: JsonValue | undefined, fallback?: number): number => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('TOOL_ARGUMENTS_INVALID');
  return Number(value);
};

const argvValue = (value: JsonValue | undefined): string[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ARGV_ITEMS) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  let total = 0;
  const argv = value.map((item) => {
    if (typeof item !== 'string' || item.includes('\0')) throw new Error('TOOL_ARGUMENTS_INVALID');
    const bytes = Buffer.byteLength(item, 'utf8');
    if (bytes > MAX_ARG_BYTES) throw new Error('TOOL_ARGUMENTS_INVALID');
    total += bytes;
    return item;
  });
  if (total > MAX_TOTAL_ARG_BYTES) throw new Error('TOOL_ARGUMENTS_INVALID');
  return argv;
};

const commandValue = (value: JsonValue | undefined): UnifiedShellCommand => {
  const command = record(value as JsonValue);
  onlyKeys(command, ['kind', 'argv', 'text']);
  if (command.kind === 'argv') {
    if (command.text !== undefined) throw new Error('TOOL_ARGUMENTS_INVALID');
    return { kind: 'argv', argv: argvValue(command.argv) };
  }
  if (command.kind === 'shell') {
    if (command.argv !== undefined) throw new Error('TOOL_ARGUMENTS_INVALID');
    return { kind: 'shell', text: stringValue(command.text, MAX_SHELL_BYTES) };
  }
  throw new Error('TOOL_ARGUMENTS_INVALID');
};

const shellRisk = (command: string): 'mutate' | 'destructive' | 'forbidden' => {
  if (
    /(^|[;&|]\s*)rm\s+-rf\s+\/(?:\s|$)/i.test(command) ||
    /\/var\/run\/docker\.sock/i.test(command) ||
    /(^|\s)(?:mkfs(?:\.[a-z0-9]+)?|wipefs)\s/i.test(command)
  ) {
    return 'forbidden';
  }
  if (/(^|[;&|]\s*)(?:shutdown|reboot|poweroff)\b/i.test(command) || /\brm\s+-rf\b/i.test(command)) {
    return 'destructive';
  }
  return 'mutate';
};

const operation = (
  cryptoHash: CryptoHashPort,
  context: ToolContext,
  toolName: string,
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
        ...('target' in target ? { target: target.target, id: target.id } : {}),
        targetIdentity: target.targetIdentity,
        endpoint: target.endpoint,
        loginUser: target.loginUser,
        configurationHash: target.configurationHash,
        connectionId: target.connectionId ?? null,
        workspaceId: target.workspaceId ?? null,
        generation: target.generation ?? null,
      },
      arguments: normalizedArguments,
      resourceKeys: [...new Set(resourceKeys)].sort(),
      preconditions: [...preconditions]
        .sort((a, b) => `${a.kind}\0${a.key}`.localeCompare(`${b.kind}\0${b.key}`))
        .map((item) => ({ kind: item.kind, key: item.key, observedValue: item.observedValue })),
      policyRevision,
      inputRevision: context.inputRevision,
    },
    cryptoHash,
  );

const jobSemantic = (job: WorkspaceJobView): NonNullable<ToolResult['semantic']> => ({
  kind: 'execution',
  target: { target: 'workspace', id: job.workspaceId },
  status: job.status,
  job: { jobId: job.jobId, workspaceId: job.workspaceId, generation: job.generation },
});

const jobStateKey = (status: WorkspaceJobView['status']): string =>
  `agent.conversation.toolSummary.labels.jobState.${status}`;

const workspaceExecutionResult = (job: WorkspaceJobView, mode: 'foreground' | 'background'): ToolResult => {
  if (mode === 'background' && (job.status === 'pending' || job.status === 'running')) {
    return {
      ok: true,
      summary: 'Workspace background job accepted by the durable Runner job journal.',
      userSummary: { key: 'agent.conversation.toolSummary.backgroundJobAccepted' },
      data: { jobId: job.jobId, workspaceId: job.workspaceId, generation: job.generation, status: job.status },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      semantic: jobSemantic(job),
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
      userSummary: { key: 'agent.conversation.toolSummary.jobOutcomeUnknown' },
      data: { jobId: job.jobId, workspaceId: job.workspaceId, generation: job.generation, status: job.status },
      artifactRefs: [],
      truncated: false,
      outcome: 'unknown',
      errorCode: job.error ?? 'WORKSPACE_JOB_OUTCOME_UNKNOWN',
      semantic: jobSemantic(job),
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
      userSummary: { key: 'agent.conversation.toolSummary.jobState', params: { stateKey: jobStateKey(job.status) } },
      data: {
        jobId: job.jobId,
        workspaceId: job.workspaceId,
        generation: job.generation,
        status: job.status,
        errorCode: job.error ?? null,
      },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      errorCode: job.error ?? 'WORKSPACE_JOB_FAILED',
      semantic: jobSemantic(job),
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
      ? 'Workspace command completed successfully.'
      : job.result.timedOut
        ? 'Workspace command timed out.'
        : `Workspace command exited with code ${job.result.exitCode}.`,
    userSummary: ok
      ? { key: 'agent.conversation.toolSummary.commandCompleted' }
      : job.result.timedOut
        ? { key: 'agent.conversation.toolSummary.commandTimedOut' }
        : {
            key: 'agent.conversation.toolSummary.commandExited',
            params: { code: job.result.exitCode ?? 0 },
          },
    data: {
      jobId: job.jobId,
      workspaceId: job.workspaceId,
      generation: job.generation,
      status: job.status,
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
    semantic: { ...jobSemantic(job), status: ok ? 'succeeded' : 'failed' },
    verification: {
      status: ok ? 'verified' : 'failed',
      summary: ok
        ? 'Runner confirmed a zero exit code inside the requested Workspace generation.'
        : 'Runner confirmed that the Workspace command returned a non-success result.',
      evidenceRefs: [],
    },
  };
};

const utf8Tail = (value: string, maxBytes: number): { text: string; truncated: boolean } => {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= maxBytes) return { text: value, truncated: false };
  let start = buffer.byteLength - maxBytes;
  while (start < buffer.byteLength && (buffer[start]! & 0xc0) === 0x80) start += 1;
  return { text: buffer.subarray(start).toString('utf8'), truncated: true };
};

const jobControlResult = (
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
      userSummary:
        action === 'cancel'
          ? { key: 'agent.conversation.toolSummary.jobCancelPending', params: { stateKey: jobStateKey(job.status) } }
          : action === 'wait'
            ? {
                key: 'agent.conversation.toolSummary.jobWaitWindowExpired',
                params: { stateKey: jobStateKey(job.status) },
              }
            : { key: 'agent.conversation.toolSummary.jobState', params: { stateKey: jobStateKey(job.status) } },
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
      semantic: jobSemantic(job),
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
      userSummary: { key: 'agent.conversation.toolSummary.jobCancelled' },
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
      semantic: jobSemantic(job),
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
      userSummary: { key: 'agent.conversation.toolSummary.jobState', params: { stateKey: jobStateKey(job.status) } },
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
      semantic: jobSemantic(job),
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
    userSummary: ok
      ? { key: 'agent.conversation.toolSummary.jobCompleted' }
      : job.result.timedOut
        ? { key: 'agent.conversation.toolSummary.jobTimedOut' }
        : { key: 'agent.conversation.toolSummary.jobExited', params: { code: job.result.exitCode ?? 0 } },
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
    semantic: { ...jobSemantic(job), status: ok ? 'succeeded' : 'failed' },
    verification: {
      status: ok ? 'verified' : 'failed',
      summary: ok
        ? 'Runner durable job state confirms a zero exit code inside the bound Workspace generation.'
        : 'Runner durable job state confirms a non-success command result.',
      evidenceRefs: [],
    },
  };
};

const targetSchema: Record<string, JsonValue> = {
  target: { type: 'string', enum: ['workspace', 'ssh'] },
  id: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
};

export const createShellExecuteTool = (shell: ShellCapabilityService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'shell_execute',
    version: '1.0.0',
    description:
      'Execute a command on an explicit Workspace or SSH target. Workspace uses argv without a shell and supports durable background jobs; SSH uses explicit shell text in foreground mode.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...targetSchema,
        command: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['argv', 'shell'] },
            argv: { type: 'array', minItems: 1, maxItems: MAX_ARGV_ITEMS, items: { type: 'string' } },
            text: { type: 'string', minLength: 1, maxLength: MAX_SHELL_BYTES },
          },
          required: ['kind'],
        },
        cwd: { type: 'string', minLength: 1, maxLength: MAX_CWD_BYTES },
        timeoutSeconds: { type: 'integer', minimum: 1, maximum: 300 },
        mode: { type: 'string', enum: ['foreground', 'background'] },
      },
      required: ['target', 'id', 'command'],
    },
    riskClass: 'mutate',
    capability: 'shell.execute',
  },
  isAvailable: ({ environment, connectionIds }) =>
    environment !== null || connectionIds === undefined || connectionIds.length > 0,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['target', 'id', 'command', 'cwd', 'timeoutSeconds', 'mode']);
    const selector = selectorFrom(args);
    const command = commandValue(args.command);
    const resolved = await shell.resolve(context, selector);
    const timeoutSeconds = positiveInteger(
      args.timeoutSeconds,
      Math.min(300, Math.max(1, context.deadlineAt - Math.floor(Date.now() / 1000))),
    );
    const rawMode = args.mode === undefined ? 'foreground' : stringValue(args.mode, 16);
    if (rawMode !== 'foreground' && rawMode !== 'background') throw new Error('TOOL_ARGUMENTS_INVALID');
    if (selector.target === 'workspace' && command.kind !== 'argv') throw new Error('TOOL_ARGUMENTS_INVALID');
    if (selector.target === 'ssh' && command.kind !== 'shell') throw new Error('TOOL_ARGUMENTS_INVALID');
    if (selector.target === 'ssh' && (rawMode !== 'foreground' || args.cwd !== undefined)) {
      throw new Error('TOOL_ARGUMENTS_INVALID');
    }
    const cwd =
      selector.target === 'workspace'
        ? args.cwd === undefined
          ? '/workspace/work'
          : stringValue(args.cwd, MAX_CWD_BYTES)
        : undefined;
    const normalizedArguments: JsonValue = {
      target: resolved.selector.target,
      id: resolved.selector.id,
      command,
      timeoutSeconds,
      mode: rawMode,
      ...(cwd === undefined ? {} : { cwd }),
    };
    const risk = command.kind === 'shell' ? shellRisk(command.text) : 'mutate';
    return {
      toolName: 'shell_execute',
      toolVersion: '1.0.0',
      normalizedArguments,
      target: resolved.fingerprint,
      resourceKeys: resolved.resourceKeys,
      risk,
      mutation: risk !== 'forbidden',
      operationHash: operation(
        cryptoHash,
        context,
        'shell_execute',
        resolved.fingerprint,
        normalizedArguments,
        resolved.resourceKeys,
        resolved.preconditions,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions: resolved.preconditions,
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const command = commandValue(args.command);
    const mode = stringValue(args.mode, 16) as 'foreground' | 'background';
    const target = shell.bindInspectionTarget(inspection.target);
    const executed = await shell.execute(context, target, {
      command,
      ...(args.cwd === undefined ? {} : { cwd: stringValue(args.cwd, MAX_CWD_BYTES) }),
      timeoutSeconds: positiveInteger(args.timeoutSeconds),
      mode,
      operationHash: inspection.operationHash,
    });
    if (executed.job) return workspaceExecutionResult(executed.job, mode);
    if (!executed.result) throw new Error('TOOL_STATE_CONFLICT');
    const ok = executed.result.exitCode === 0;
    return {
      ok,
      summary: ok
        ? 'SSH shell command completed successfully.'
        : `SSH shell command exited with code ${executed.result.exitCode}.`,
      userSummary: ok
        ? { key: 'agent.conversation.toolSummary.sshShellCompleted' }
        : { key: 'agent.conversation.toolSummary.sshShellExited', params: { code: executed.result.exitCode ?? 0 } },
      data: {
        exitCode: executed.result.exitCode,
        signal: executed.result.signal,
        stdout: executed.result.stdout,
        stderr: executed.result.stderr,
        target: { target: executed.target.target, id: executed.target.id },
      },
      artifactRefs: [],
      truncated: executed.result.truncated,
      outcome: 'confirmed',
      ...(ok ? {} : { errorCode: 'SSH_SHELL_NONZERO_EXIT' }),
      semantic: {
        kind: 'execution',
        target: executed.target,
        status: ok ? 'succeeded' : 'failed',
      },
      verification: {
        status: ok ? 'verified' : 'failed',
        summary: ok
          ? 'The SSH command channel returned a confirmed zero exit status.'
          : 'The SSH command channel returned a confirmed non-zero exit status.',
        evidenceRefs: [],
      },
    };
  },
});

export const createShellJobTool = (shell: ShellCapabilityService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'shell_job',
    version: '1.0.0',
    description:
      'Inspect, server-side wait for, or cancel one durable Workspace background shell job. Requires the explicit Workspace target that owns the job.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: { type: 'string', enum: ['workspace'] },
        id: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
        jobId: { type: 'string', pattern: '^job-[a-f0-9]{64}$' },
        action: { type: 'string', enum: ['status', 'wait', 'cancel'] },
        waitSeconds: { type: 'integer', minimum: 1, maximum: 300 },
      },
      required: ['target', 'id', 'jobId', 'action'],
    },
    riskClass: 'control',
    capability: 'shell.execute',
  },
  isAvailable: ({ environment }) => environment !== null,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['target', 'id', 'jobId', 'action', 'waitSeconds']);
    const selector = selectorFrom(args);
    if (selector.target !== 'workspace') throw new Error('TOOL_ARGUMENTS_INVALID');
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
    const resolved = await shell.resolveJob(context, selector, jobId);
    const normalizedArguments: JsonValue = {
      target: 'workspace',
      id: resolved.target.selector.id,
      jobId,
      action,
      ...(waitSeconds === undefined ? {} : { waitSeconds }),
    };
    return {
      toolName: 'shell_job',
      toolVersion: '1.0.0',
      normalizedArguments,
      target: resolved.target.fingerprint,
      resourceKeys: resolved.target.resourceKeys,
      risk: 'control',
      mutation: false,
      operationHash: operation(
        cryptoHash,
        context,
        'shell_job',
        resolved.target.fingerprint,
        normalizedArguments,
        resolved.target.resourceKeys,
        resolved.target.preconditions,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions: resolved.target.preconditions,
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const target = shell.bindInspectionTarget(inspection.target);
    const action = stringValue(args.action, 16) as 'status' | 'wait' | 'cancel';
    const job = await shell.controlJob(
      context,
      target,
      stringValue(args.jobId, 80),
      action,
      args.waitSeconds === undefined ? undefined : positiveInteger(args.waitSeconds),
    );
    return jobControlResult(job, action, context.maxOutputBytes);
  },
});

export const createUnifiedShellTools = (shell: ShellCapabilityService, cryptoHash: CryptoHashPort): AgentTool[] => [
  createShellExecuteTool(shell, cryptoHash),
  createShellJobTool(shell, cryptoHash),
];
