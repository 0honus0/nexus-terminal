import type { WorkspaceJobView } from '@nexus-terminal/protocol/runner';
import { WORKSPACE_JOB_LIMITS as runnerJobLimits } from '@nexus-terminal/protocol/runner';
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

import type { SshJobView } from '../../capabilities/ssh-session.port';
import { sshSessionContext } from './ssh-session-input';

const sshJobResult = (job: SshJobView, maxOutputBytes: number): ToolResult => {
  const budget = Math.max(1, Math.min(64 * 1024, Math.floor(maxOutputBytes / 4)));
  const stdout = utf8Tail(job.result.stdout, budget);
  const stderr = utf8Tail(job.result.stderr, budget);
  return {
    ok: job.status === 'running' || job.status === 'succeeded',
    summary: `SSH job ${job.status}.`,
    userSummary: {
      key: 'agent.conversation.toolSummary.jobState',
      params: { stateKey: `agent.conversation.toolSummary.labels.jobState.${job.status}` },
    },
    data: {
      jobId: job.jobId,
      sessionId: job.sessionId,
      connectionId: job.connectionId,
      status: job.status,
      ...job.result,
      stdout: stdout.text,
      stderr: stderr.text,
    },
    artifactRefs: [],
    truncated: job.result.truncated || stdout.truncated || stderr.truncated,
    // The queried record is confirmed, even when the remote command outcome is unknown.
    outcome: 'confirmed',
    ...(job.status === 'unknown' ? { errorCode: 'SSH_JOB_OUTCOME_UNKNOWN' } : {}),
    semantic: { kind: 'execution', target: { target: 'ssh', id: String(job.connectionId) }, status: job.status },
    verification: {
      status:
        job.status === 'succeeded'
          ? 'verified'
          : job.status === 'failed' || job.status === 'cancelled'
            ? 'failed'
            : 'unverified',
      summary:
        job.status === 'succeeded'
          ? 'SSH confirmed a zero exit code.'
          : 'Submission or channel closure alone does not prove successful execution.',
      evidenceRefs: [],
    },
  };
};

const MAX_ID_BYTES = 128;
const MAX_ARGV_ITEMS = 128;
const MAX_ARG_BYTES = 8 * 1024;
const MAX_TOTAL_ARG_BYTES = 64 * 1024;
const MAX_SHELL_BYTES = 32 * 1024;
const MAX_CWD_BYTES = 4096;

function invalidArgument(code: string, detail: string): never {
  throw new Error(code, { cause: new Error(`${detail} No command was executed.`) });
}

const record = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object')
    invalidArgument('SHELL_OBJECT_REQUIRED', 'Tool arguments and command must be JSON objects.');
  return value as Record<string, JsonValue>;
};

const onlyKeys = (value: Record<string, JsonValue>, allowed: readonly string[]): void => {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key)))
    invalidArgument('SHELL_UNKNOWN_FIELD', `Only these fields are accepted here: ${allowed.join(', ')}.`);
};

const stringValue = (value: JsonValue | undefined, maxBytes: number, field = 'string field'): string => {
  if (typeof value !== 'string' || !value || value.includes('\0') || Buffer.byteLength(value, 'utf8') > maxBytes) {
    invalidArgument(
      'SHELL_STRING_INVALID',
      `${field} must be a non-empty string without NUL, at most ${maxBytes} UTF-8 bytes.`,
    );
  }
  return value;
};

const targetKind = (value: JsonValue | undefined): AgentTargetKind => {
  if (value !== 'workspace' && value !== 'ssh')
    invalidArgument(
      'SHELL_TARGET_INVALID',
      'target must be workspace or ssh. Both accept argv and shellScript commands.',
    );
  return value;
};

const selectorFrom = (args: Record<string, JsonValue>) => ({
  target: targetKind(args.target),
  id: stringValue(args.id, MAX_ID_BYTES, 'id'),
});

const positiveInteger = (value: JsonValue | undefined, fallback?: number): number => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    invalidArgument(
      'SHELL_POSITIVE_INTEGER_REQUIRED',
      'timeoutSeconds/waitSeconds must be a positive safe integer in seconds.',
    );
  return Number(value);
};

const argvValue = (value: JsonValue | undefined): string[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ARGV_ITEMS) {
    invalidArgument('SHELL_ARGV_COUNT_INVALID', `command.argv must contain 1 to ${MAX_ARGV_ITEMS} strings.`);
  }
  let total = 0;
  const argv = value.map((item) => {
    if (typeof item !== 'string' || item.includes('\0'))
      invalidArgument('SHELL_ARGV_ITEM_INVALID', 'Each command.argv item must be a string without NUL.');
    const bytes = Buffer.byteLength(item, 'utf8');
    if (bytes > MAX_ARG_BYTES)
      invalidArgument(
        'SHELL_ARGV_ITEM_TOO_LARGE',
        `Each command.argv item must be at most ${MAX_ARG_BYTES} UTF-8 bytes.`,
      );
    total += bytes;
    return item;
  });
  if (total > MAX_TOTAL_ARG_BYTES)
    invalidArgument(
      'SHELL_ARGV_TOO_LARGE',
      `Combined command.argv must be at most ${MAX_TOTAL_ARG_BYTES} UTF-8 bytes.`,
    );
  if (!argv[0])
    invalidArgument('SHELL_EXECUTABLE_EMPTY', 'command.argv[0] must be a non-empty executable name or path.');
  return argv;
};

const commandValue = (value: JsonValue | undefined): UnifiedShellCommand => {
  const command = record(value as JsonValue);
  onlyKeys(command, ['kind', 'argv', 'shellScript']);
  if (command.kind === 'argv') {
    if (command.shellScript !== undefined)
      invalidArgument(
        'SHELL_COMMAND_FIELDS_CONFLICT',
        'kind=argv accepts argv, not shellScript; select one command form.',
      );
    return { kind: 'argv', argv: argvValue(command.argv) };
  }
  if (command.kind === 'shell') {
    if (command.argv !== undefined)
      invalidArgument(
        'SHELL_COMMAND_FIELDS_CONFLICT',
        'kind=shell accepts shellScript, not argv; select one command form.',
      );
    return { kind: 'shell', shellScript: stringValue(command.shellScript, MAX_SHELL_BYTES, 'command.shellScript') };
  }
  return invalidArgument(
    'SHELL_COMMAND_KIND_INVALID',
    'command.kind must be argv or shell; both forms work on Workspace and SSH.',
  );
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
      summary:
        'Workspace background job accepted and active. Keep this jobId; do not resubmit to obtain a result. For services, run health checks; for completion, use shell_job_control wait.',
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
  if (job.status === 'cancelled' || !job.result) {
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
  const ok =
    job.status === 'succeeded' && job.result.exitCode === 0 && !job.result.timedOut && job.result.signal === null;
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
            : `Workspace job is ${job.status}. This is authoritative active state, not failure or missing details. Keep this jobId; verify service health or use bounded wait, rather than starting it again.`,
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
  if (job.status === 'unknown' || !job.result) {
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
  const ok =
    job.status === 'succeeded' && job.result.exitCode === 0 && !job.result.timedOut && job.result.signal === null;
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
      'Execute argv or shellScript on either Workspace or SSH, with optional cwd. argv preserves literal argument boundaries (SSH safely quotes for its remote shell); shellScript is executable source, not a title (Workspace /bin/sh -c). Pass required environment variables via argv=[env,KEY=value,executable,...] or shellScript. Workspace foreground/background Jobs share configured generation capacity (default 8; 1=serial); full capacity rejects, never queues. Active Jobs block file-tool writes, not reads. Serialize dependent/shared writers; no file isolation. Background returns jobId; use shell_job_control list/status/wait/cancel, not busy-polling or detached bypasses. SSH background requires sessionId. timeoutSeconds kills the process when its execution lifetime expires, including background services; it is not a startup/health-check timeout. Choose an explicit bounded lifetime covering the requested service period and verification/cleanup; never promise indefinite uptime. Before reporting a service still running, check its Job status and endpoints; health evidence is only a point-in-time observation.',
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
            shellScript: {
              type: 'string',
              minLength: 1,
              maxLength: MAX_SHELL_BYTES,
              description:
                'Executable shell script, not a display title; use with kind=shell on either Workspace or SSH. Workspace executes /bin/sh -c; SSH uses its remote command shell.',
            },
          },
          required: ['kind'],
        },
        cwd: { type: 'string', minLength: 1, maxLength: MAX_CWD_BYTES },
        timeoutSeconds: {
          type: 'integer',
          minimum: runnerJobLimits.minExecutionTimeoutMs / 1000,
          maximum: runnerJobLimits.maxExecutionTimeoutMs / 1000,
          description: `Hard process execution lifetime, including background services; expiry terminates the Job. Not a startup, health-check or result wait window. Workspace default is ${runnerJobLimits.defaultExecutionTimeoutMs / 1000} seconds. For a service, explicitly cover the requested operating period plus verification and cleanup; report the bounded lifetime.`,
        },
        sessionId: { type: 'string', minLength: 1, maxLength: 128 },
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
    onlyKeys(args, ['target', 'id', 'command', 'cwd', 'timeoutSeconds', 'mode', 'sessionId']);
    const sessionContext = sshSessionContext(args, context);
    const selector = selectorFrom(args);
    const command = commandValue(args.command);
    const resolved = await shell.resolve(context, selector);
    await shell.inspectSshSession(sessionContext, resolved);
    const rawMode = args.mode === undefined ? 'foreground' : stringValue(args.mode, 16, 'mode');
    if (rawMode !== 'foreground' && rawMode !== 'background')
      invalidArgument('SHELL_MODE_INVALID', 'mode must be foreground or background.');
    const timeoutSeconds = positiveInteger(
      args.timeoutSeconds,
      selector.target === 'workspace'
        ? runnerJobLimits.defaultExecutionTimeoutMs / 1000
        : selector.target === 'ssh' && rawMode === 'background'
          ? 3600
          : Math.min(300, Math.max(1, context.deadlineAt - Math.floor(Date.now() / 1000))),
    );
    if (
      timeoutSeconds >
      (selector.target === 'workspace'
        ? runnerJobLimits.maxExecutionTimeoutMs / 1000
        : rawMode === 'background'
          ? 86400
          : 300)
    )
      invalidArgument(
        'SHELL_TIMEOUT_EXCEEDED',
        `timeoutSeconds exceeds the execution limit: ${selector.target === 'workspace' ? runnerJobLimits.maxExecutionTimeoutMs / 1000 : rawMode === 'background' ? 86400 : 300} seconds for this target/mode.`,
      );
    if (selector.target === 'ssh' && rawMode === 'background' && args.sessionId === undefined)
      throw new Error('SSH_SESSION_REQUIRED');
    const cwd =
      args.cwd === undefined
        ? selector.target === 'workspace'
          ? '/workspace/work'
          : undefined
        : stringValue(args.cwd, MAX_CWD_BYTES, 'cwd');
    const normalizedArguments: JsonValue = {
      target: resolved.selector.target,
      id: resolved.selector.id,
      command,
      timeoutSeconds,
      mode: rawMode,
      ...(args.sessionId === undefined ? {} : { sessionId: args.sessionId }),
      ...(cwd === undefined ? {} : { cwd }),
    };
    const risk = command.kind === 'shell' ? shellRisk(command.shellScript) : 'mutate';
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
    const executed = await shell.execute(sshSessionContext(args, context), target, {
      command,
      ...(args.cwd === undefined ? {} : { cwd: stringValue(args.cwd, MAX_CWD_BYTES) }),
      timeoutSeconds: positiveInteger(args.timeoutSeconds),
      mode,
      operationHash: inspection.operationHash,
    });
    if (executed.job || executed.sshJob) {
      const result = executed.job
        ? workspaceExecutionResult(executed.job, mode)
        : sshJobResult(executed.sshJob!, context.maxOutputBytes);
      if (mode === 'background') {
        const executionTimeoutSeconds = positiveInteger(args.timeoutSeconds);
        result.data = { ...record(result.data ?? {}), executionTimeoutSeconds } as JsonValue;
        if (
          executed.job?.status === 'pending' ||
          executed.job?.status === 'running' ||
          executed.sshJob?.status === 'running'
        ) {
          result.summary += ` Execution lifetime is ${executionTimeoutSeconds} seconds from process start; expiry terminates this Job. This is not a startup timeout. Verify Job status and endpoints before reporting current uptime; do not claim indefinite availability.`;
          if (target.selector.target === 'workspace') {
            result.summary +=
              ' Workspace Job control is scoped to this Run/Runtime: cancel while this Run is active if requested. For user cleanup after this Run ends, use the authenticated Workspace management API, not Agent tools or a new Run: GET /api/v1/apps/{appId}/workspaces/{workspaceId}, then POST /api/v1/apps/{appId}/workspaces/{workspaceId}/actions with schemaVersion=1, current expectedVersion and action=stop or delete, CSRF and Idempotency-Key. Stop affects all Jobs in that Workspace generation; confirm the returned command succeeded and final Workspace state.';
          }
        }
      }
      return result;
    }
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
    name: 'shell_job_control',
    version: '1.0.0',
    modelExposure: 'deferred',
    description:
      'Workspace/SSH Job list/status/wait/cancel; list omits jobId and returns authorized active Jobs (Workspace adds generation capacity; SSH is scoped to this Thread/connection). Wait expiry leaves Jobs running, not failed. Prefer bounded wait to busy-polling; cancel only an authorized Job. SSH disconnect outcomes are unknown, never replayed.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: { type: 'string', enum: ['workspace', 'ssh'] },
        id: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
        jobId: { type: 'string', minLength: 1, maxLength: 80 },
        action: { type: 'string', enum: ['list', 'status', 'wait', 'cancel'] },
        waitSeconds: { type: 'integer', minimum: 1, maximum: 300 },
      },
      required: ['target', 'id', 'action'],
    },
    riskClass: 'control',
    capability: 'shell.execute',
  },
  isAvailable: ({ environment, connectionIds }) =>
    environment !== null || connectionIds === undefined || connectionIds.length > 0,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['target', 'id', 'jobId', 'action', 'waitSeconds']);
    const selector = selectorFrom(args);
    const action = stringValue(args.action, 16);
    if (action !== 'list' && action !== 'status' && action !== 'wait' && action !== 'cancel')
      invalidArgument('SHELL_JOB_ACTION_INVALID', 'action must be list, status, wait or cancel.');
    if (action === 'list' && args.jobId !== undefined)
      invalidArgument(
        'SHELL_JOB_LIST_FIELDS_CONFLICT',
        'list returns authorized active jobs on either target; omit jobId.',
      );
    const jobId = action === 'list' ? undefined : stringValue(args.jobId, 80);
    if (
      jobId !== undefined &&
      !(selector.target === 'ssh' ? /^ssh-job-[a-f0-9-]{36}$/ : /^job-[a-f0-9]{64}$/).test(jobId)
    )
      invalidArgument(
        'SHELL_JOB_ID_INVALID',
        'jobId must be the exact ID returned by shell_execute for this target (SSH ssh-job-UUID; Workspace job-64-hex).',
      );
    const waitSeconds =
      action === 'wait'
        ? positiveInteger(
            args.waitSeconds,
            Math.min(300, Math.max(1, context.deadlineAt - Math.floor(Date.now() / 1000))),
          )
        : undefined;
    if (action !== 'wait' && args.waitSeconds !== undefined)
      invalidArgument('SHELL_JOB_WAIT_FIELDS_CONFLICT', 'waitSeconds is accepted only with action=wait.');
    const resolved =
      selector.target === 'ssh' || action === 'list'
        ? { target: await shell.resolve(context, selector) }
        : await shell.resolveJob(context, selector, jobId!);
    if (selector.target === 'ssh' && action !== 'list') await shell.sshJob(context, selector, jobId!, 'status');
    const normalizedArguments: JsonValue = {
      target: selector.target,
      id: resolved.target.selector.id,
      ...(jobId === undefined ? {} : { jobId }),
      action,
      ...(waitSeconds === undefined ? {} : { waitSeconds }),
    };
    return {
      toolName: 'shell_job_control',
      toolVersion: '1.0.0',
      normalizedArguments,
      target: resolved.target.fingerprint,
      resourceKeys: resolved.target.resourceKeys,
      risk: 'control',
      mutation: false,
      operationHash: operation(
        cryptoHash,
        context,
        'shell_job_control',
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
    if (args.action === 'list') {
      const data = await shell.listActiveJobs(context, target);
      return {
        ok: true,
        summary:
          'Authorized active Jobs observed. Workspace also reports generation capacity; SSH lists this Thread/connection only, not a Workspace capacity. This does not verify command success.',
        data: { ...data, jobs: data.jobs.map((job) => ({ ...job })) },
        artifactRefs: [],
        truncated: false,
        outcome: 'confirmed',
        verification: {
          status: 'unverified',
          summary: 'Active Jobs have not reached verified terminal results.',
          evidenceRefs: [],
        },
      };
    }
    const action = stringValue(args.action, 16) as 'status' | 'wait' | 'cancel';
    if (target.selector.target === 'ssh')
      return sshJobResult(
        await shell.sshJob(
          context,
          target.selector,
          stringValue(args.jobId, 80),
          action,
          args.waitSeconds === undefined ? undefined : positiveInteger(args.waitSeconds),
        ),
        context.maxOutputBytes,
      );
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
