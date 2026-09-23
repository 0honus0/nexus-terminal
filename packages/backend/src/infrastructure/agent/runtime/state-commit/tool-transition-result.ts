import { projectToolResult } from '../../../../modules/agent/capabilities/tool-result-projection';
import type { ToolResult } from '../../../../modules/agent/capabilities/tool.types';
import type { JsonValue } from '../../../../modules/agent/agent.types';
import { pressureAdjustedToolOutputBytes } from '../../../../modules/agent/runtime/runs/run-budget-policy';
import { mapRunRow, type RunRow } from '../../repositories/sqlite-run.mapper';

export const modelToolResultJson = (row: RunRow, result: ToolResult): string => {
  const run = mapRunRow(row);
  return JSON.stringify(projectToolResult(result, pressureAdjustedToolOutputBytes(run.budget, run.usage.context)));
};

/**
 * §1.8: the ledger payload carries the model's evidence as `text` and the user's projection as a
 * sibling `userSummary`, so the conversation UI can localize the line without changing what the
 * model reads (and without adding the key to the model-facing JSON).
 */
export const toolResultLedgerPayload = (
  row: RunRow,
  result: ToolResult,
  toolCallId: string,
): Record<string, JsonValue> => ({
  toolCallId,
  text: modelToolResultJson(row, result),
  ...(result.userSummary ? { userSummary: result.userSummary as unknown as JsonValue } : {}),
});
