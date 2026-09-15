import type { Scope } from '../agent.types';
import type { ModelMessage, ModelToolSchema } from './model.types';

export interface ContextHistoryBoundary {
  baseThrough: number;
  runThrough: Record<string, number>;
}

export interface ContextRunInput {
  id: string;
  sequence: number;
  text: string;
}

export interface ContextRequest {
  scope: Scope;
  threadId: string;
  runId?: string;
  historyBoundary?: ContextHistoryBoundary;
  currentInput: string;
  currentInputEntryId?: string;
  effectiveRunInputsByRun?: Record<string, ContextRunInput[]>;
  goal?: string;
  taskPlan?: string;
  collaborationContext?: string;
  modelContextWindow: number;
  maxContextTokens: number;
  reservedOutputTokens: number;
  compactionMode?: 'aggressive' | 'balanced' | 'conservative';
  maxRecallItems: number;
  maxRecallBytes: number;
  tools?: ModelToolSchema[];
}

export interface ContextSourceRange {
  kind: 'ledger' | 'recall' | 'skill' | 'goal' | 'task_plan' | 'collaboration' | 'current_input' | 'safety';
  id?: string;
  fromSequence?: number;
  toSequence?: number;
}

export interface ContextMessageDiagnostic {
  index: number;
  role: ModelMessage['role'];
  hash: string;
  estimatedTokens: number;
}

export interface ContextPlan {
  instructions: string[];
  messages: ModelMessage[];
  toolSchemas: ModelToolSchema[];
  estimatedInputTokens: number;
  reservedOutputTokens: number;
  droppedSections: string[];
  compacted: boolean;
  compactionMode: 'aggressive' | 'balanced' | 'conservative';
  sourceRanges: ContextSourceRange[];
  contextEpoch: string;
  stablePrefixHash: string;
  toolSchemaHash: string;
  skillMetadataHash: string;
  messageDiagnostics: ContextMessageDiagnostic[];
}
