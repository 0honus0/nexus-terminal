import type { Actor, JsonValue, Scope } from '../agent.types';
import type { AgentCapability } from '../host/app.types';
import type { ToolTargetFingerprint } from './tool-target.types';

export interface ToolDescriptor {
  name: string;
  version: string;
  description: string;
  inputSchema: JsonValue;
  riskClass: 'read' | 'control' | 'mutate' | 'destructive';
  capability: AgentCapability;
}

export interface ToolPrecondition {
  kind: 'fileHash' | 'metadata' | 'serviceState' | 'environmentGeneration';
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
  risk: 'read' | 'control' | 'mutate' | 'destructive' | 'forbidden';
  mutation: boolean;
  operationHash: string;
  operationHashVersion: 1;
  preconditions: ToolPrecondition[];
  secretRefs: ToolSecretRef[];
  policyRevision: number;
  inputRevision: number;
}

export interface ToolContext extends Scope {
  actor: Actor;
  runId: string;
  agentRuntimeId: string;
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
  verification: {
    status: 'verified' | 'unverified' | 'failed';
    summary: string;
    evidenceRefs: string[];
  };
}

export interface AgentTool {
  descriptor: ToolDescriptor;
  inspect(input: JsonValue, context: ToolContext, policyRevision: number): Promise<ToolInspection>;
  execute(inspection: ToolInspection, context: ToolContext): Promise<ToolResult>;
}

export interface ToolProposal {
  providerCallId: string;
  name: string;
  argumentsJson: string;
}
