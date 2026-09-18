import type { Actor, AgentRunEnvironmentSnapshot, JsonValue, Scope } from '../agent.types';
import type { AgentCapability } from '../host/app.types';
import type { ToolTargetFingerprint } from './tool-target.types';

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
  capability: AgentCapability;
}

export interface ToolPrecondition {
  kind: 'fileHash' | 'metadata' | 'serviceState' | 'workspaceGeneration';
  key: string;
  observedValue: JsonValue;
}

export interface ToolSecretRef {
  id: string;
  version: number;
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
  secretRefs: ToolSecretRef[];
  policyRevision: number;
  inputRevision: number;
}

export interface ToolAvailabilityContext {
  environment: AgentRunEnvironmentSnapshot | null;
}

export interface ToolContext extends Scope {
  actor: Actor;
  runId: string;
  agentRuntimeId: string;
  connectionIds: readonly number[];
  environment: AgentRunEnvironmentSnapshot | null;
  stepId: string;
  signal: AbortSignal;
  deadlineAt: number;
  maxOutputBytes: number;
  inputRevision: number;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: JsonValue;
  artifactRefs: string[];
  truncated: boolean;
  outcome: 'confirmed' | 'unknown';
  errorCode?: string;
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
