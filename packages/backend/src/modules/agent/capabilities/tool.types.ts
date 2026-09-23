import type { Actor, AgentRunEnvironmentSnapshot, JsonValue, Scope } from '../agent.types';
import type { AgentCapability } from '../host/app.types';
import type { AgentTargetSelector, ToolTargetFingerprint } from './tool-target.types';

export type ToolRisk = 'read' | 'control' | 'mutate' | 'destructive' | 'forbidden';
export type ToolRiskClass = Exclude<ToolRisk, 'forbidden'>;

export interface ToolDescriptor {
  name: string;
  version: string;
  description: string;
  inputSchema: JsonValue;
  riskClass: ToolRiskClass;
  parallelSafe?: boolean;
  modelExposure?: 'direct' | 'deferred';
  capability?: AgentCapability;
}

export interface ToolPrecondition {
  kind: 'fileHash' | 'metadata' | 'serviceState' | 'workspaceGeneration';
  key: string;
  observedValue: JsonValue;
}

export interface ToolInspection {
  toolName: string;
  toolVersion: string;
  normalizedArguments: JsonValue;
  target: ToolTargetFingerprint;
  resourceKeys: string[];
  risk: ToolRisk;
  mutation: boolean;
  operationHash: string;
  operationHashVersion: 1;
  preconditions: ToolPrecondition[];
  policyRevision: number;
  inputRevision: number;
}

export interface ToolAvailabilityContext {
  environment: AgentRunEnvironmentSnapshot | null;
  connectionIds?: readonly number[];
}

export interface ToolContext extends Scope {
  actor: Actor;
  runId: string;
  agentRuntimeId: string;
  toolCallId?: string;
  connectionIds: readonly number[];
  environment: AgentRunEnvironmentSnapshot | null;
  stepId: string;
  signal: AbortSignal;
  deadlineAt: number;
  maxOutputBytes: number;
  inputRevision: number;
  continuation?: JsonValue;
}

export type ToolExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';

export interface ToolExecutionJobSemantic {
  jobId: string;
  workspaceId: string;
  generation: number;
}

export interface ToolExecutionSemantic {
  kind: 'execution';
  target: AgentTargetSelector;
  status: ToolExecutionStatus;
  job?: ToolExecutionJobSemantic;
}

export type ToolResultSemantic = ToolExecutionSemantic;

/**
 * §1.8: `ToolResult.summary` is English execution evidence written for the model, so it must stay
 * verbatim and stable. This is the *user* projection instead: an i18n key plus locale-neutral params
 * (numbers, paths, ids) that the conversation UI renders in the active locale. It is deliberately
 * stripped before the result is sent to the model and carried in the ledger payload beside the text.
 */
export interface ToolUserSummary {
  key: string;
  params?: Record<string, JsonValue>;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  userSummary?: ToolUserSummary;
  data?: JsonValue;
  artifactRefs: string[];
  truncated: boolean;
  outcome: 'confirmed' | 'unknown';
  errorCode?: string;
  semantic?: ToolResultSemantic;
  projection?: { originalBytes: number; sha256: string };
  verification: {
    status: 'verified' | 'unverified' | 'failed';
    summary: string;
    evidenceRefs: string[];
  };
}

export interface AgentTool {
  descriptor: ToolDescriptor;
  isAvailable?(context: ToolAvailabilityContext): boolean;
  inspect(input: JsonValue, context: ToolContext, policyRevision: number): Promise<ToolInspection>;
  execute(inspection: ToolInspection, context: ToolContext): Promise<ToolResult>;
}

export interface ToolProposal {
  providerCallId: string;
  name: string;
  argumentsJson: string;
}
