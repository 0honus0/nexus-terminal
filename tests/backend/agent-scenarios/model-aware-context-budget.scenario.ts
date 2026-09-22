import assert from 'node:assert/strict';
import {
  freezeRunContextPolicy,
  pressureAdjustedToolOutputBytes,
  resolveModelContextBudget,
} from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import type { RunView } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { scope } from './scenario-fixtures';
import { contextService, entry } from './scenario-context-helpers';

export const modelAwareContextBudgetScenario = async () => {
  const normal = freezeRunContextPolicy('normal');
  const extended = freezeRunContextPolicy('extended');
  assert.deepEqual(normal, {
    profile: 'normal',
    effectiveWindowPercent: 92,
    softPressurePercent: 80,
    toolOutputFloorPercent: 25,
  });
  assert.deepEqual(extended, {
    profile: 'extended',
    effectiveWindowPercent: 96,
    softPressurePercent: 88,
    toolOutputFloorPercent: 40,
  });

  const normalWindow = resolveModelContextBudget(normal, 200_000, 8_000);
  const extendedWindow = resolveModelContextBudget(extended, 200_000, 8_000);
  assert.deepEqual(normalWindow, {
    physicalInputTokens: 192_000,
    effectiveInputTokens: 176_640,
    softPressureTokens: 141_312,
  });
  assert.deepEqual(extendedWindow, {
    physicalInputTokens: 192_000,
    effectiveInputTokens: 184_320,
    softPressureTokens: 162_201,
  });

  const budget: RunView['budget'] = {
    contextPolicy: normal,
    maxRunSteps: 80,
    maxActiveExecutionSeconds: 1_800,
    toolTimeoutSeconds: 60,
    maxToolOutputBytes: 65_536,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    maxSubagentMessages: 1_000,
    maxSubagentMessageBytes: 2_097_152,
    contextCompactionMode: 'balanced',
    revision: 1,
  };
  const atHardPressure = pressureAdjustedToolOutputBytes(budget, {
    inputTokens: normalWindow.effectiveInputTokens,
    reservedOutputTokens: 8_000,
    contextWindowTokens: 200_000,
    source: 'provider',
    updatedAt: 2,
  });
  assert.equal(atHardPressure, 16_384);

  const earlyPressurePlan = await contextService(
    Array.from({ length: 8 }, (_, index) =>
      entry(index + 1, index % 2 === 0 ? 'user_input' : 'assistant_message', {
        text: 'history '.repeat(160),
      }),
    ),
  ).compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Continue.',
    modelContextWindow: 8_192,
    maxContextTokens: 2_300,
    softContextTokens: 900,
    reservedOutputTokens: 512,
    maxRecallItems: 1,
    maxRecallBytes: 1_024,
    tools: [],
  });
  assert.equal(earlyPressurePlan.compacted, true);

  const currentInputMarker = 'CURRENT_INPUT_CHECKPOINT_DEDUP_MARKER';
  const currentInputText = `${currentInputMarker} Preserve this input exactly once.`;
  const dedupPlan = await contextService([
    entry(1, 'user_input', { text: currentInputText }),
    entry(2, 'assistant_message', { text: 'historical assistant context '.repeat(220) }),
    entry(3, 'assistant_message', { text: 'older working notes '.repeat(220) }),
  ]).compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: currentInputText,
    currentInputEntryId: 'entry-1',
    modelContextWindow: 4_096,
    maxContextTokens: 1_800,
    softContextTokens: 1_200,
    reservedOutputTokens: 128,
    maxRecallItems: 1,
    maxRecallBytes: 1_024,
    tools: [],
  });
  const currentInputOccurrences =
    dedupPlan.messages
      .map((message) => message.content)
      .join('\n')
      .split(currentInputMarker).length - 1;
  assert.equal(
    currentInputOccurrences,
    1,
    'current input must not reappear through a derived checkpoint when context pressure compacts history',
  );

  const latestToolCallId = 'current-turn-tool-call';
  const latestExchangePlan = await contextService([
    entry(1, 'user_input', { text: 'Preserve the latest causal Tool exchange.' }),
    entry(2, 'assistant_message', {
      text: '',
      toolCalls: [{ id: latestToolCallId, name: 'skill_read', argumentsJson: '{"id":"nexus.agent.developer"}' }],
    }),
    entry(3, 'tool_result', {
      toolCallId: latestToolCallId,
      text: 'latest tool result '.repeat(380),
    }),
  ]).compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Preserve the latest causal Tool exchange.',
    currentInputEntryId: 'entry-1',
    modelContextWindow: 8_192,
    maxContextTokens: 7_000,
    softContextTokens: 900,
    reservedOutputTokens: 512,
    maxRecallItems: 1,
    maxRecallBytes: 1_024,
    tools: [],
  });
  assert.equal(latestExchangePlan.compacted, true, 'latest causal exchange regression must exercise compaction');
  assert.ok(
    latestExchangePlan.messages.some((message) => message.role === 'tool' && message.toolCallId === latestToolCallId),
    'soft-pressure selection must retain the newest complete Tool exchange before reserving summary/recall space',
  );

  return [
    { name: 'normal_effective_context_tokens', value: normalWindow.effectiveInputTokens, unit: 'tokens' },
    { name: 'extended_effective_context_tokens', value: extendedWindow.effectiveInputTokens, unit: 'tokens' },
    { name: 'pressure_tool_output_floor_bytes', value: atHardPressure, unit: 'bytes' },
    { name: 'soft_pressure_compactions', value: earlyPressurePlan.compacted ? 1 : 0, unit: 'plans' },
    { name: 'current_input_projection_occurrences', value: currentInputOccurrences, unit: 'messages' },
    {
      name: 'latest_causal_tool_exchange_retained',
      value: latestExchangePlan.messages.some((message) => message.role === 'tool') ? 1 : 0,
      unit: 'exchanges',
    },
  ];
};
