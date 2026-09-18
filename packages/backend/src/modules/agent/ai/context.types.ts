import type { Scope } from '../agent.types';
import type { ContextUsageAnchor } from './model-accounting';
import type { ModelMessage, ModelToolSchema } from './model.types';
import type { ProjectInstructionSnapshot } from './project-instruction-source.port';

export interface ContextHistoryBoundary {
  baseThrough: number;
  runThrough: Record<string, number>;
}

export interface ContextRunInput {
  id: string;
  sequence: number;
  text: string;
  artifactRefs?: string[];
}

export interface ContextRequest {
  scope: Scope;
  threadId: string;
  runId?: string;
  historyBoundary?: ContextHistoryBoundary;
  currentInput: string;
  currentInputEntryId?: string;
  currentInputArtifactRefs?: string[];
  modelInputCapabilities?: {
    supportsImageInput: boolean;
    supportsFileInput: boolean;
  };
  effectiveRunInputsByRun?: Record<string, ContextRunInput[]>;
  goal?: string;
  taskPlan?: string;
  collaborationContext?: string;
  projectInstructions?: ProjectInstructionSnapshot[];
  modelContextWindow: number;
  maxContextTokens: number;
  reservedOutputTokens: number;
  compactionMode?: 'aggressive' | 'balanced' | 'conservative';
  maxRecallItems: number;
  maxRecallBytes: number;
  tools?: ModelToolSchema[];
  usageAnchor?: ContextUsageAnchor;
}

export interface ContextSourceRange {
  kind:
    | 'ledger'
    | 'thread_anchor'
    | 'thread_recall'
    | 'summary_checkpoint'
    | 'recall'
    | 'skill'
    | 'project_instruction'
    | 'goal'
    | 'task_plan'
    | 'collaboration'
    | 'current_input'
    | 'safety';
  id?: string;
  hash?: string;
  fromSequence?: number;
  toSequence?: number;
}

export interface ContextMessageDiagnostic {
  index: number;
  role: ModelMessage['role'];
  hash: string;
  estimatedTokens: number;
}

export interface ContextTokenDiagnostics {
  safetyTokens: number;
  currentInputTokens: number;
  stableInstructionTokens: number;
  toolSchemaTokens: number;
  skillMetadataTokens: number;
  projectInstructionTokens: number;
  rawHistoryTokens: number;
  toolExchangeTokens: number;
  threadAnchorTokens: number;
  threadRecallTokens: number;
  summaryCheckpointTokens: number;
  recallTokens: number;
  goalTokens: number;
  taskPlanTokens: number;
  collaborationTokens: number;
}

export interface ContextPlan {
  instructions: string[];
  messages: ModelMessage[];
  toolSchemas: ModelToolSchema[];
  estimatedInputTokens: number;
  heuristicInputTokens: number;
  estimationSource: 'estimated' | 'anchored_estimate';
  anchorDeltaTokens: number;
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
  tokenDiagnostics: ContextTokenDiagnostics;
}
