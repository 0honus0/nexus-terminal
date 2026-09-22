import type { AgentJsonValueDto, AgentToolRiskDto, AgentVersionedRequestDto } from './agent-common.js';
import type {
  AgentApprovalModeDto,
  AgentContextCompactionModeDto,
  AgentContextProfileDto,
} from './agent-host.js';
import type { AgentModelCapabilityDto, AgentReasoningEffortDto } from './agent-providers.js';

export interface AgentModelRefDto {
  providerId: string;
  modelId: string;
  configurationVersion: number;
}

export interface AgentModelCapabilitySnapshotDto {
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsImageInput: boolean;
  supportsFileInput: boolean;
  supportsPromptCacheKey?: boolean;
  reasoningEfforts?: AgentReasoningEffortDto[];
  defaultReasoningEffort?: AgentReasoningEffortDto;
  reasoningMandatory?: boolean;
}

export interface AgentDefinitionModelCompatibilityDto extends AgentModelRefDto {
  compatible: boolean;
  missingCapabilities: AgentModelCapabilityDto[];
}

export interface AgentDefinitionViewDto {
  id: string;
  version: string;
  displayName: string;
  description: string;
  requiredModelCapabilities: AgentModelCapabilityDto[];
  modelCompatibility: AgentDefinitionModelCompatibilityDto[];
}

export interface AgentRunEnvironmentSelectionDto {
  recipeId: string;
  versions?: Record<string, string>;
  runnerPluginIds?: string[];
  acpProfileIds?: string[];
  browserTargetId?: string;
  catalogRevision?: string;
}

export interface AgentRunEnvironmentToolchainPackDto {
  familyId: string;
  versionId: string;
  contentDigest: string;
}

export interface AgentRunEnvironmentRunnerPluginDto {
  pluginId: string;
  version: string;
  sdkVersion: string;
  protocolVersion: 3;
  packageHash: string;
  entry: string;
}

export interface AgentRunEnvironmentAcpProfileDto {
  id: string;
  profileRevision: number;
  argv: string[];
  cwd: string;
}

export interface AgentRunEnvironmentBrowserEndpointDto {
  scope: 'docker-network' | 'external-network';
  via: 'backend' | 'runner';
  url: string;
  priority: number;
  allowPlaintext: boolean;
  verifyTls: boolean;
}

export interface AgentRunEnvironmentBrowserTargetDto {
  id: string;
  profileRevision: number;
  endpoints: AgentRunEnvironmentBrowserEndpointDto[];
  allowedUrlPatterns: string[];
}

export interface AgentRunEnvironmentSnapshotDto {
  kind: 'shell' | 'code' | 'data' | 'browser';
  recipeId: string;
  recipeRevision: string;
  runtimeDigest: string;
  catalogRevision: string;
  toolchain: AgentRunEnvironmentToolchainPackDto[];
  runnerPlugins: AgentRunEnvironmentRunnerPluginDto[];
  acpProfiles: AgentRunEnvironmentAcpProfileDto[];
  browserTarget: AgentRunEnvironmentBrowserTargetDto | null;
}

export type AgentRunStatusDto =
  | 'created'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_budget'
  | 'awaiting_input'
  | 'cancelling'
  | 'completed'
  | 'completed_unverified'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type AgentGoalStatusDto = 'unknown' | 'in_progress' | 'satisfied' | 'not_satisfied';
export type AgentVerificationStatusDto = 'not_started' | 'verified' | 'unverified' | 'failed';
export type AgentExecutionModeDto = 'execute' | 'plan';

export interface AgentRunGoalDto {
  text: string | null;
  revision: number;
  updatedAt: number | null;
}

export type AgentPlanItemStatusDto = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export interface AgentPlanItemDto {
  id: string;
  title: string;
  detail: string | null;
  status: AgentPlanItemStatusDto;
  dependsOn: string[];
  evidenceRefs: string[];
}

export interface AgentRunPlanDto {
  schemaVersion: 1;
  revision: number;
  items: AgentPlanItemDto[];
}

export interface AgentRunContextPolicyDto {
  profile: AgentContextProfileDto;
  effectiveWindowPercent: number;
  softPressurePercent: number;
  toolOutputFloorPercent: number;
}

export interface AgentRunBudgetDto {
  contextPolicy: AgentRunContextPolicyDto;
  maxRunSteps: number;
  maxActiveExecutionSeconds: number;
  toolTimeoutSeconds: number;
  maxToolOutputBytes: number;
  maxRecallItems: number;
  maxRecallBytes: number;
  maxSubagentMessages: number;
  maxSubagentMessageBytes: number;
  contextCompactionMode: AgentContextCompactionModeDto;
  revision: number;
}

export interface AgentRunBudgetIncreaseDto {
  maxRunSteps?: number;
  maxActiveExecutionSeconds?: number;
  maxSubagentMessages?: number;
  maxSubagentMessageBytes?: number;
}

export interface AgentRunContextUsageDto {
  inputTokens: number;
  heuristicInputTokens?: number;
  reservedOutputTokens: number;
  contextWindowTokens: number;
  source: 'estimated' | 'anchored_estimate' | 'provider';
  model?: AgentModelRefDto;
  contextEpoch?: string;
  updatedAt: number;
}

export interface AgentRunUsageDto {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  steps: number;
  subagentMessages: number;
  subagentMessageBytes: number;
  context?: AgentRunContextUsageDto;
}

export interface AgentRunContextBoundaryDto {
  baseThrough: number;
  runThrough: Record<string, number>;
}

export interface AgentRunModelRouteSnapshotDto {
  model: AgentModelRefDto;
  modelCapabilities: AgentModelCapabilitySnapshotDto;
}

export interface AgentRunDefinitionSnapshotDto {
  schemaVersion: 1;
  agentDefinitionId: string;
  requiredModelCapabilities: AgentModelCapabilityDto[];
  model: AgentModelRefDto;
  modelCapabilities: AgentModelCapabilitySnapshotDto;
  rootModelRoutes: AgentRunModelRouteSnapshotDto[];
  reasoningEffort?: AgentReasoningEffortDto;
  approvalMode: AgentApprovalModeDto;
  executionMode: AgentExecutionModeDto;
  connectionIds: number[];
  environment: AgentRunEnvironmentSnapshotDto | null;
  policyRevision: number;
  settingsRevision: number;
  contextBoundary?: AgentRunContextBoundaryDto;
}

export interface AgentRunViewDto {
  id: string;
  userId: number;
  appId: string;
  threadId: string;
  parentRunId: string | null;
  status: AgentRunStatusDto;
  goalStatus: AgentGoalStatusDto;
  goal: AgentRunGoalDto;
  verificationStatus: AgentVerificationStatusDto;
  needsReconciliation: boolean;
  budget: AgentRunBudgetDto;
  definition: AgentRunDefinitionSnapshotDto;
  plan: AgentRunPlanDto;
  usage: AgentRunUsageDto;
  activeExecutionSeconds: number;
  activeExecutionStartedAt: number | null;
  executingRuntimeCount: number;
  consumedInputSequence: number;
  inputRevision: number;
  eventCursor: number;
  version: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface AgentRunTerminalIssueDto {
  eventType: string;
  errorCode: string | null;
  reason: string | null;
  occurredAt: number;
}

export interface AgentUserInputChoiceDto {
  value: string;
  label: string;
  description?: string;
}

export interface AgentUserInputQuestionDto {
  id: string;
  prompt: string;
  kind: 'text' | 'choice';
  choices?: AgentUserInputChoiceDto[];
  recommendedChoice?: string;
  context?: string;
}

export interface AgentPendingUserInputRequestDto {
  id: string;
  runtimeId: string;
  questions: AgentUserInputQuestionDto[];
  requestedAt: number;
}

export interface AgentRunSnapshotDto extends AgentRunViewDto {
  terminalIssue: AgentRunTerminalIssueDto | null;
  pendingInputRequest: AgentPendingUserInputRequestDto | null;
  recentEntries: Array<{
    id: string;
    sequence: number;
    kind: string;
    payload: AgentJsonValueDto;
    createdAt: number;
  }>;
}

export interface AgentRunPageDto {
  items: AgentRunViewDto[];
  nextCursor: string | null;
}

export interface AgentRunListQueryDto {
  limit: number;
  threadId?: string;
  before?: string;
}

export interface AgentRunReconciliationResourceDto {
  resourceKey: string;
  toolCallId: string | null;
  reason: string;
  version: number;
  createdAt: number;
}

export interface AgentRunReconciliationViewDto {
  runId: string;
  required: boolean;
  resources: AgentRunReconciliationResourceDto[];
}

export interface AgentPendingRunInputDto {
  id: string;
  sequence: number;
  text: string;
  artifactRefs: string[];
  createdAt: number;
}

export interface AgentPendingRunInputPageDto {
  items: AgentPendingRunInputDto[];
  total: number;
  hasMore: boolean;
}

export interface AgentUserInputDataDto {
  text: string;
  artifactRefs: string[];
}

export interface AgentCreateRunFieldsDto {
  threadId: string;
  input: AgentUserInputDataDto;
  agentDefinitionId: string;
  model: AgentModelRefDto;
  reasoningEffort?: AgentReasoningEffortDto;
  approvalMode: AgentApprovalModeDto;
  executionMode: AgentExecutionModeDto;
  plannedFromRunId?: string;
  connectionIds: number[];
  environment?: AgentRunEnvironmentSelectionDto | null;
  initialGoal?: string;
}

export type AgentCreateRunRequestDto = AgentVersionedRequestDto<AgentCreateRunFieldsDto>;

export interface AgentExpectedVersionFieldsDto {
  expectedVersion: number;
}

export type AgentExpectedVersionRequestDto = AgentVersionedRequestDto<AgentExpectedVersionFieldsDto>;

export interface AgentRunReconciliationResolveFieldsDto {
  expectedVersion: number;
  note: string;
  resources: Array<{ resourceKey: string; version: number }>;
}

export type AgentRunReconciliationResolveRequestDto =
  AgentVersionedRequestDto<AgentRunReconciliationResolveFieldsDto>;

export interface AgentRunAppendInputFieldsDto extends AgentUserInputDataDto {
  expectedVersion: number;
}

export type AgentRunAppendInputRequestDto = AgentVersionedRequestDto<AgentRunAppendInputFieldsDto>;

export interface AgentRunAppendInputResponseDto {
  inputId: string;
  sequence: number;
  runVersion: number;
}

export interface AgentRunPendingInputMutationFieldsDto {
  action: 'remove' | 'move';
  inputId: string;
  beforeInputId: string | null;
  expectedVersion: number;
}

export type AgentRunPendingInputMutationRequestDto =
  AgentVersionedRequestDto<AgentRunPendingInputMutationFieldsDto>;

export interface AgentRunSetGoalFieldsDto {
  text: string;
  expectedVersion: number;
}

export type AgentRunSetGoalRequestDto = AgentVersionedRequestDto<AgentRunSetGoalFieldsDto>;

export interface AgentRunResumeFieldsDto {
  checkpointId: string;
  expectedVersion: number;
}

export type AgentRunResumeRequestDto = AgentVersionedRequestDto<AgentRunResumeFieldsDto>;

export interface AgentRunBudgetIncreaseFieldsDto {
  increase: AgentRunBudgetIncreaseDto;
  expectedVersion: number;
}

export type AgentRunBudgetIncreaseRequestDto = AgentVersionedRequestDto<AgentRunBudgetIncreaseFieldsDto>;

export interface AgentRunDeleteQueryDto {
  expectedVersion: number;
}

export interface AgentRunDeleteResponseDto {
  runId: string;
  deleted: true;
}

export type AgentCheckpointToolStatusDto =
  | 'proposed'
  | 'awaiting_approval'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'verification_failed'
  | 'failed'
  | 'cancelled'
  | 'reconciling';

export interface AgentCheckpointToolRecoveryEntryDto {
  toolCallId: string;
  operationHash: string;
  risk: AgentToolRiskDto;
  status: AgentCheckpointToolStatusDto;
  sideEffectStatus: 'not_started' | 'confirmed' | 'unknown';
  verificationStatus: AgentVerificationStatusDto;
  quarantinedResourceKeys: string[];
}

export interface AgentCheckpointDelegationRecoveryEntryDto {
  delegationId: string;
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
}

export interface AgentCheckpointBackgroundJobEntryDto {
  jobId: string;
  workspaceId: string;
  generation: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
}

export interface AgentCheckpointRecoveryManifestDto {
  schemaVersion: 1;
  eventThrough: number;
  contextBoundary: AgentRunContextBoundaryDto;
  tools: AgentCheckpointToolRecoveryEntryDto[];
  delegations: AgentCheckpointDelegationRecoveryEntryDto[];
  backgroundJobs: AgentCheckpointBackgroundJobEntryDto[];
  quarantinedResourceKeys: string[];
}

export interface AgentCheckpointSnapshotDto {
  schemaVersion: 1;
  runId: string;
  ledgerThrough: number;
  planVersion: number;
  inputRevision: number;
  settingsRevision: number;
  plan: AgentRunPlanDto;
  goal: AgentRunGoalDto;
  completedStepIds: string[];
  evidenceRefs: string[];
  checkpointArtifactRefs: string[];
  modelConfigurationVersion: number;
  activeModel: AgentModelRefDto;
  definitionVersion: string;
  policyRevision: number;
  workspaceArtifactManifestRefs: string[];
  workspaceArtifactRefs: string[];
  recoveryManifest: AgentCheckpointRecoveryManifestDto;
}

export interface AgentCheckpointViewDto {
  id: string;
  runId: string;
  kind: 'user' | 'recovery';
  schemaVersion: 1;
  ledgerThrough: number;
  eventThrough: number;
  snapshot: AgentCheckpointSnapshotDto;
  createdAt: number;
}
