import type { TokenUsage } from '../../ai/model.types';
import type { JsonValue } from '../../agent.types';
import type { ToolInspection, ToolProposal } from '../../capabilities/tool.types';
import { executionErrorCode } from './execution-errors';
import type { RunSnapshot, RunUsage, RunView } from '../runs/run.types';
import { requestHash } from '../runs/idempotency';

export const MAX_TOOL_CALLS_PER_MODEL_STEP = 64;

export const latestRunInputText = (run: RunSnapshot): string => {
  for (let index = run.recentEntries.length - 1; index >= 0; index -= 1) {
    const entry = run.recentEntries[index]!;
    if (
      entry.kind !== 'user_input' ||
      !entry.payload ||
      Array.isArray(entry.payload) ||
      typeof entry.payload !== 'object'
    ) {
      continue;
    }
    const text = (entry.payload as Record<string, JsonValue>).text;
    if (typeof text === 'string') return text;
  }
  return '';
};

export const rejectedToolInspection = (run: RunView, proposal: ToolProposal, failureCode: string): ToolInspection => {
  const operationHash = requestHash(1, {
    kind: 'rejected_tool_call',
    runId: run.id,
    providerCallId: proposal.providerCallId,
    toolName: proposal.name,
    argumentsJson: proposal.argumentsJson,
    inputRevision: run.inputRevision,
    failureCode,
  });
  return {
    toolName: proposal.name,
    toolVersion: 'unavailable',
    normalizedArguments: {},
    target: {
      kind: 'run',
      targetIdentity: `run:${run.id}:rejected-tool:${proposal.providerCallId}`,
      endpoint: `run:${run.id}`,
      loginUser: `agent-runtime:${run.id}`,
      configurationHash: operationHash,
    },
    resourceKeys: [],
    risk: 'forbidden',
    mutation: false,
    operationHash,
    operationHashVersion: 1,
    preconditions: [],
    policyRevision: run.definition.policyRevision,
    inputRevision: run.inputRevision,
  };
};

export const usageWithModel = (base: RunUsage, delta: TokenUsage): RunUsage => ({
  inputTokens: base.inputTokens + delta.inputTokens,
  outputTokens: base.outputTokens + delta.outputTokens,
  cachedInputTokens: base.cachedInputTokens + delta.cachedInputTokens,
  steps: base.steps + 1,
  subagentMessages: base.subagentMessages,
  subagentMessageBytes: base.subagentMessageBytes,
});

export const usageWithAttempt = (base: RunUsage, delta: TokenUsage): RunUsage => ({
  inputTokens: base.inputTokens + delta.inputTokens,
  outputTokens: base.outputTokens + delta.outputTokens,
  cachedInputTokens: base.cachedInputTokens + delta.cachedInputTokens,
  steps: base.steps,
  subagentMessages: base.subagentMessages,
  subagentMessageBytes: base.subagentMessageBytes,
});

export const errorCode = (error: unknown): string => executionErrorCode(error, 'MODEL_EXECUTION_FAILED');

export const signalReason = (signal: AbortSignal): string | null => {
  if (!signal.aborted) return null;
  const reason = signal.reason;
  if (reason instanceof Error) return reason.message;
  return typeof reason === 'string' ? reason : 'ABORTED';
};
