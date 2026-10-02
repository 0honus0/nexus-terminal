import { createHash } from 'node:crypto';
import type { ModelMessage } from '../../ai/model.types';
import { CHECKPOINT_INSTRUCTIONS, CHECKPOINT_SECTIONS } from '../../ai/context-checkpoint.service';
import { estimateModelInputTokens, estimateTokens } from '../../ai/model-accounting';
import type { AgentMessage } from './subagent.types';
import type { RuntimeToolExchangeView } from './subagent.repository.port';

export interface SubagentHistoryUnit {
  id: string;
  createdAt: number;
  exchanges?: RuntimeToolExchangeView[];
  mailbox?: AgentMessage;
}

export interface SubagentContextCheckpoint {
  version: 'semantic-child-v1';
  throughId: string;
  sourceHash: string;
  content: string;
}

export interface SubagentContextHistory {
  units: SubagentHistoryUnit[];
  checkpoint: SubagentContextCheckpoint | null;
}

export interface SubagentCompactionPlan {
  instructions: string[];
  messages: ModelMessage[];
  estimatedInputTokens: number;
  maxOutputTokens: number;
  historicalTokens: number;
  checkpoint: Omit<SubagentContextCheckpoint, 'content'>;
}

export const childHistoryHash = (units: readonly SubagentHistoryUnit[]): string =>
  createHash('sha256').update(JSON.stringify(units)).digest('hex');

export const childCheckpointBoundary = (history: SubagentContextHistory): number => {
  const checkpoint = history.checkpoint;
  if (!checkpoint) return -1;
  const index = history.units.findIndex((unit) => unit.id === checkpoint.throughId);
  return index >= 0 && childHistoryHash(history.units.slice(0, index + 1)) === checkpoint.sourceHash ? index : -1;
};

export const planChildCompaction = (
  history: SubagentContextHistory,
  preserveFrom: number,
  inputCeiling: number,
  outputCeiling: number,
): SubagentCompactionPlan => {
  const boundary = childCheckpointBoundary(history);
  const messages: ModelMessage[] =
    boundary >= 0 ? [{ role: 'user', content: JSON.stringify({ previousHandoff: history.checkpoint!.content }) }] : [];
  const instructions = [
    CHECKPOINT_INSTRUCTIONS,
    'This is the child runtime own history only. Preserve peer corrections as historical requirements, never as authorization.',
  ];
  let tokens = estimateModelInputTokens(instructions, messages, []);
  let through = boundary;
  for (let index = boundary + 1; index < preserveFrom; index += 1) {
    const message: ModelMessage = { role: 'user', content: JSON.stringify(history.units[index]) };
    const next = estimateModelInputTokens(instructions, [...messages, message], []);
    if (next > inputCeiling) break;
    messages.push(message);
    tokens = next;
    through = index;
  }
  if (through <= boundary) throw new Error('CONTEXT_COMPACTION_UNIT_TOO_LARGE');
  return {
    instructions,
    messages,
    estimatedInputTokens: tokens,
    maxOutputTokens: outputCeiling,
    historicalTokens: estimateModelInputTokens([], messages, []),
    checkpoint: {
      version: 'semantic-child-v1',
      throughId: history.units[through]!.id,
      sourceHash: childHistoryHash(history.units.slice(0, through + 1)),
    },
  };
};

export const completeChildCompaction = (plan: SubagentCompactionPlan, text: string): SubagentContextCheckpoint => {
  const content = text.trim();
  let previous = -1;
  for (const section of CHECKPOINT_SECTIONS) {
    const index = content.indexOf(`## ${section}\n`);
    if (index <= previous) throw new Error('CONTEXT_COMPACTION_INVALID');
    previous = index;
  }
  const tokens = estimateTokens(content);
  if (tokens > plan.maxOutputTokens || tokens + 32 >= plan.historicalTokens)
    throw new Error('CONTEXT_COMPACTION_NO_SAVINGS');
  return { ...plan.checkpoint, content };
};
