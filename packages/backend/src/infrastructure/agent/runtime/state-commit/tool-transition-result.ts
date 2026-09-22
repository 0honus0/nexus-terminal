import { projectToolResult } from '../../../../modules/agent/capabilities/tool-result-projection';
import type { ToolResult } from '../../../../modules/agent/capabilities/tool.types';
import { pressureAdjustedToolOutputBytes } from '../../../../modules/agent/runtime/runs/run-budget-policy';
import { mapRunRow, type RunRow } from '../../repositories/sqlite-run.mapper';

export const modelToolResultJson = (row: RunRow, result: ToolResult): string => {
  const run = mapRunRow(row);
  return JSON.stringify(projectToolResult(result, pressureAdjustedToolOutputBytes(run.budget, run.usage.context)));
};
