import assert from 'node:assert/strict';
import { scope } from './scenario-fixtures';
import { assertValidToolExchange, contextService, entry } from './scenario-context-helpers';

export const contextToolExchangeScenario = async () => {
  const largeArguments = JSON.stringify({ path: '/workspace/work/example.ts', patch: 'x'.repeat(2_048) });
  const service = contextService([
    entry(1, 'user_input', { text: 'Inspect the repository and fix the issue.' }),
    entry(2, 'assistant_message', {
      text: '',
      toolCalls: [
        { id: 'call-a', name: 'file_read', argumentsJson: largeArguments },
        { id: 'call-b', name: 'file_search', argumentsJson: JSON.stringify({ query: 'needle' }) },
      ],
    }),
    entry(3, 'tool_result', { toolCallId: 'call-a', content: 'file contents '.repeat(24) }),
    entry(4, 'tool_result', { toolCallId: 'call-b', content: 'search result '.repeat(24) }),
    entry(5, 'assistant_message', { text: 'I found the relevant call sites.' }),
  ]);

  let compactedRuns = 0;
  for (const budget of [273, 320, 384, 512, 768, 1_024]) {
    const plan = await service.compose({
      scope,
      threadId: 'scenario-thread',
      runId: 'scenario-run',
      currentInput: 'Continue with the fix.',
      modelContextWindow: 4_096,
      maxContextTokens: budget,
      reservedOutputTokens: 128,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      compactionMode: 'balanced',
      tools: [],
    });
    assertValidToolExchange(plan.messages);
    if (plan.compacted) compactedRuns += 1;
  }

  const fullPlan = await service.compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Continue with the fix.',
    modelContextWindow: 8_192,
    maxContextTokens: 8_000,
    reservedOutputTokens: 128,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    tools: [],
  });
  const assistantDiagnostic = fullPlan.messageDiagnostics.find(
    (diagnostic) => diagnostic.role === 'assistant' && diagnostic.estimatedTokens > 100,
  );
  assert.ok(assistantDiagnostic, 'structured tool-call arguments must contribute to token accounting');

  const historyEntries = [
    entry(1, 'user_input', { text: 'Historical request.' }, 'history-run'),
    entry(
      2,
      'assistant_message',
      {
        text: '',
        toolCalls: [
          { id: 'history-call-a', name: 'file_read', argumentsJson: '{"path":"a"}' },
          { id: 'history-call-b', name: 'file_search', argumentsJson: '{"query":"b"}' },
        ],
      },
      'history-run',
    ),
    entry(3, 'tool_result', { toolCallId: 'history-call-a', content: 'first terminal result' }, 'history-run'),
    entry(4, 'tool_result', { toolCallId: 'history-call-b', content: 'second terminal result' }, 'history-run'),
  ];
  for (const baseThrough of [2, 3]) {
    const boundaryPlan = await contextService(historyEntries).compose({
      scope,
      threadId: 'scenario-thread',
      runId: 'scenario-run',
      historyBoundary: { baseThrough, runThrough: {} },
      currentInput: 'Continue after the checkpoint.',
      modelContextWindow: 8_192,
      maxContextTokens: 8_000,
      reservedOutputTokens: 128,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      tools: [],
    });
    assertValidToolExchange(boundaryPlan.messages);
    assert.ok(
      boundaryPlan.droppedSections.some((section) => section.startsWith('ledger-exchange-incomplete:')),
      'history boundary fragments must leave an explicit incomplete-exchange diagnostic',
    );
  }

  const pageBoundaryEntries = [
    entry(1, 'assistant_message', {
      text: '',
      toolCalls: [{ id: 'page-call', name: 'file_read', argumentsJson: '{"path":"old"}' }],
    }),
    entry(2, 'tool_result', { toolCallId: 'page-call', content: 'old terminal result' }),
    ...Array.from({ length: 159 }, (_, index) =>
      entry(index + 3, 'user_input', { text: `later ledger entry ${index + 1}` }),
    ),
  ];
  const pageBoundaryPlan = await contextService(pageBoundaryEntries).compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Continue from the recent page.',
    modelContextWindow: 8_192,
    maxContextTokens: 8_000,
    reservedOutputTokens: 128,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    tools: [],
  });
  assertValidToolExchange(pageBoundaryPlan.messages);
  assert.ok(
    pageBoundaryPlan.droppedSections.some((section) => section.startsWith('ledger-exchange-incomplete:')),
    'fixed-size page orphan fragments must leave an explicit incomplete-exchange diagnostic',
  );

  const terminalOutcomePlan = await contextService([
    entry(1, 'assistant_message', {
      text: '',
      toolCalls: [
        { id: 'denied-call', name: 'workspace_write', argumentsJson: '{}' },
        { id: 'expired-call', name: 'workspace_write', argumentsJson: '{}' },
        { id: 'superseded-call', name: 'workspace_write', argumentsJson: '{}' },
        { id: 'cancelled-call', name: 'workspace_write', argumentsJson: '{}' },
      ],
    }),
    entry(2, 'tool_result', {
      toolCallId: 'denied-call',
      text: JSON.stringify({ ok: false, outcome: 'confirmed', errorCode: 'APPROVAL_DENIED' }),
    }),
    entry(3, 'tool_result', {
      toolCallId: 'expired-call',
      text: JSON.stringify({ ok: false, outcome: 'confirmed', errorCode: 'APPROVAL_EXPIRED' }),
    }),
    entry(4, 'tool_result', {
      toolCallId: 'superseded-call',
      text: JSON.stringify({ ok: false, outcome: 'confirmed', errorCode: 'APPROVAL_SUPERSEDED' }),
    }),
    entry(5, 'tool_result', {
      toolCallId: 'cancelled-call',
      text: JSON.stringify({ ok: false, outcome: 'confirmed', errorCode: 'RUN_CANCELLED_BEFORE_TOOL_EXECUTION' }),
    }),
  ]).compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Continue after terminal tool outcomes.',
    modelContextWindow: 8_192,
    maxContextTokens: 8_000,
    reservedOutputTokens: 128,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    tools: [],
  });
  assertValidToolExchange(terminalOutcomePlan.messages);
  assert.equal(
    terminalOutcomePlan.messages.filter((message) => message.role === 'tool').length,
    4,
    'denied/expired/superseded/cancelled canonical tool results must remain in the assistant batch',
  );

  const reusedToolCallId = 'provider-reused-tool-call-id';
  const reusedToolCallPlan = await contextService([
    entry(1, 'user_input', { text: 'Load the historical Skill.' }, 'history-run'),
    entry(
      2,
      'assistant_message',
      {
        text: '',
        toolCalls: [{ id: reusedToolCallId, name: 'skill_read', argumentsJson: '{"id":"nexus.agent.developer"}' }],
      },
      'history-run',
    ),
    entry(3, 'tool_result', { toolCallId: reusedToolCallId, content: 'historical Skill body' }, 'history-run'),
    entry(4, 'assistant_message', { text: 'Historical Skill loaded.' }, 'history-run'),
    entry(5, 'user_input', { text: 'Continue from the compacted thread.' }, 'current-run'),
    entry(
      6,
      'assistant_message',
      {
        text: '',
        toolCalls: [{ id: reusedToolCallId, name: 'skill_read', argumentsJson: '{"id":"nexus.agent.developer"}' }],
      },
      'current-run',
    ),
    entry(7, 'tool_result', { toolCallId: reusedToolCallId, content: 'current Skill body' }, 'current-run'),
  ]).compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'current-run',
    currentInput: 'Continue from the compacted thread.',
    currentInputEntryId: 'entry-5',
    modelContextWindow: 8_192,
    maxContextTokens: 8_000,
    reservedOutputTokens: 128,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    tools: [],
  });
  assertValidToolExchange(reusedToolCallPlan.messages);
  assert.equal(
    reusedToolCallPlan.messages.filter((message) => message.role === 'tool' && message.toolCallId === reusedToolCallId)
      .length,
    2,
    'reused provider Tool call ids must bind to the nearest unsettled assistant exchange instead of becoming ambiguous',
  );
  assert.ok(
    !reusedToolCallPlan.droppedSections.some((section) => section.startsWith('ledger-exchange-incomplete:')),
    'reusing a Tool call id in a later Run must not invalidate either complete exchange',
  );

  return [
    { name: 'budget_variants', value: 6, unit: 'cases' },
    { name: 'compacted_variants', value: compactedRuns, unit: 'cases' },
    { name: 'tool_argument_estimate', value: assistantDiagnostic.estimatedTokens, unit: 'tokens' },
    { name: 'boundary_fragment_cases', value: 3, unit: 'cases' },
    { name: 'terminal_outcome_variants', value: 4, unit: 'cases' },
    { name: 'reused_tool_call_id_exchanges', value: 2, unit: 'exchanges' },
  ];
};
