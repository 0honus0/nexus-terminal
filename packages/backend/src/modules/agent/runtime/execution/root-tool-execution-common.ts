import type { JsonValue } from '../../agent.types';
import type { ToolContext, ToolResult } from '../../capabilities/tool.types';
import type { RunView } from '../runs/run.types';

export const rejectedRootToolResult = (errorCode: string, summary: string): ToolResult => ({
  ok: false,
  summary,
  data: { error: { code: errorCode, message: summary } },
  artifactRefs: [],
  truncated: false,
  outcome: 'confirmed',
  errorCode,
  verification: { status: 'failed', summary: 'The tool call was not executed.', evidenceRefs: [] },
});

export const rootToolContext = (
  run: RunView,
  runtimeId: string,
  stepId: string,
  signal: AbortSignal,
  nowUnixSeconds: number,
  continuation?: JsonValue,
  toolCallId?: string,
): ToolContext => ({
  userId: run.userId,
  appId: run.appId,
  actor: {
    kind: 'agent',
    userId: run.userId,
    appId: run.appId,
    runId: run.id,
    agentRuntimeId: runtimeId,
  },
  runId: run.id,
  agentRuntimeId: runtimeId,
  ...(toolCallId === undefined ? {} : { toolCallId }),
  connectionIds: [...run.definition.connectionIds],
  environment: run.definition.environment ?? null,
  stepId,
  signal,
  deadlineAt: nowUnixSeconds + run.budget.toolTimeoutSeconds,
  maxOutputBytes: run.budget.maxToolOutputBytes,
  inputRevision: run.inputRevision,
  ...(continuation === undefined ? {} : { continuation }),
});
