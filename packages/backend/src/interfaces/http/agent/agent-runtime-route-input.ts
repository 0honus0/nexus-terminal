import type { AgentRunEnvironmentSelection, JsonValue } from '../../../modules/agent/agent.types';
import type { AgentWorkspaceCreateSpec } from '../../../modules/agent/workspace-runtime/workspace-runtime.types';
import type { RunBudgetIncrease, UserInputData } from '../../../modules/agent/runtime/runs/run.types';
import { hasOnlyKeys, isJsonValue, isRecord, positiveInteger, versionedRecord } from './agent-route-input';

export const AGENT_RUNTIME_REQUEST_SCHEMA_VERSION = 1 as const;

export interface CreateRunRequestDto {
  threadId: string;
  input: UserInputData;
  agentDefinitionId: string;
  model: { providerId: string; modelId: string; configurationVersion: number };
  connectionIds: number[];
  environment?: AgentRunEnvironmentSelection | null;
  initialGoal?: string;
}

export interface ApprovalResolveRequestDto {
  decision: 'approved' | 'denied';
  operationHash: string;
  expectedVersion: number;
}

export interface WorkspaceCreateRequestDto {
  workspace: AgentWorkspaceCreateSpec;
  retained: boolean;
  catalogRevision?: string;
}

export interface WorkspaceActionRequestDto {
  action: 'start' | 'stop' | 'restart' | 'delete';
  expectedVersion: number;
}

export interface WorkspaceToolVersionsRequestDto {
  versions: Record<string, string>;
  expectedVersion: number;
  catalogRevision?: string;
}

const parseUserInput = (value: unknown): UserInputData => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['text', 'artifactRefs'])) throw new Error('VALIDATION_FAILED');
  if (
    typeof value.text !== 'string' ||
    Buffer.byteLength(value.text, 'utf8') > 32 * 1024 ||
    !Array.isArray(value.artifactRefs) ||
    value.artifactRefs.length > 10
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  if (value.artifactRefs.some((item) => typeof item !== 'string')) throw new Error('VALIDATION_FAILED');
  return { text: value.text, artifactRefs: value.artifactRefs as string[] };
};

export const parseCreateRunRequest = (body: unknown): CreateRunRequestDto => {
  const value = versionedRecord(body, [
    'threadId',
    'input',
    'agentDefinitionId',
    'model',
    'connectionIds',
    'environment',
    'initialGoal',
  ]);
  const model = value.model;
  if (!isRecord(model) || !hasOnlyKeys(model, ['providerId', 'modelId', 'configurationVersion'])) {
    throw new Error('VALIDATION_FAILED');
  }
  if (
    typeof value.threadId !== 'string' ||
    typeof value.agentDefinitionId !== 'string' ||
    typeof model.providerId !== 'string' ||
    typeof model.modelId !== 'string' ||
    !positiveInteger(model.configurationVersion) ||
    !Array.isArray(value.connectionIds) ||
    value.connectionIds.length > 50 ||
    value.connectionIds.some((connectionId) => !positiveInteger(connectionId)) ||
    (value.initialGoal !== undefined &&
      (typeof value.initialGoal !== 'string' ||
        !value.initialGoal.trim() ||
        Buffer.byteLength(value.initialGoal.trim(), 'utf8') > 4096))
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    threadId: value.threadId,
    input: parseUserInput(value.input),
    agentDefinitionId: value.agentDefinitionId,
    model: {
      providerId: model.providerId,
      modelId: model.modelId,
      configurationVersion: model.configurationVersion,
    },
    connectionIds: value.connectionIds as number[],
    ...(value.environment === undefined ? {} : { environment: parseRunEnvironmentSelection(value.environment) }),
    ...(typeof value.initialGoal === 'string' && value.initialGoal.trim()
      ? { initialGoal: value.initialGoal.trim() }
      : {}),
  };
};

export const parseExpectedVersionRequest = (body: unknown): number => {
  const value = versionedRecord(body, ['expectedVersion']);
  if (!positiveInteger(value.expectedVersion)) throw new Error('VALIDATION_FAILED');
  return value.expectedVersion;
};

export const parseAppendInputRequest = (body: unknown): { input: UserInputData; expectedVersion: number } => {
  const value = versionedRecord(body, ['text', 'artifactRefs', 'expectedVersion']);
  if (!positiveInteger(value.expectedVersion)) throw new Error('VALIDATION_FAILED');
  return {
    input: parseUserInput({ text: value.text, artifactRefs: value.artifactRefs }),
    expectedVersion: value.expectedVersion,
  };
};

export const parsePendingInputMutationRequest = (
  body: unknown,
): { action: 'remove' | 'move'; inputId: string; beforeInputId: string | null; expectedVersion: number } => {
  const value = versionedRecord(body, ['action', 'inputId', 'beforeInputId', 'expectedVersion']);
  if (
    !['remove', 'move'].includes(String(value.action)) ||
    typeof value.inputId !== 'string' ||
    value.inputId.length < 1 ||
    value.inputId.length > 128 ||
    (value.beforeInputId !== undefined && value.beforeInputId !== null && typeof value.beforeInputId !== 'string') ||
    !positiveInteger(value.expectedVersion)
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  const action = value.action as 'remove' | 'move';
  const beforeInputId = typeof value.beforeInputId === 'string' ? value.beforeInputId : null;
  if ((action === 'remove' && beforeInputId !== null) || (action === 'move' && beforeInputId === value.inputId)) {
    throw new Error('VALIDATION_FAILED');
  }
  return { action, inputId: value.inputId, beforeInputId, expectedVersion: value.expectedVersion };
};

export const parseSetGoalRequest = (body: unknown): { text: string; expectedVersion: number } => {
  const value = versionedRecord(body, ['text', 'expectedVersion']);
  if (
    typeof value.text !== 'string' ||
    !value.text.trim() ||
    Buffer.byteLength(value.text.trim(), 'utf8') > 4096 ||
    !positiveInteger(value.expectedVersion)
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return { text: value.text.trim(), expectedVersion: value.expectedVersion };
};

export const parseResumeRunRequest = (body: unknown): { checkpointId: string; expectedVersion: number } => {
  const value = versionedRecord(body, ['checkpointId', 'expectedVersion']);
  if (
    typeof value.checkpointId !== 'string' ||
    value.checkpointId.length < 1 ||
    value.checkpointId.length > 256 ||
    !positiveInteger(value.expectedVersion)
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return { checkpointId: value.checkpointId, expectedVersion: value.expectedVersion };
};

const parseBudgetIncrease = (value: unknown): RunBudgetIncrease => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'maxRunTokens',
      'maxRunSteps',
      'maxActiveExecutionSeconds',
      'maxSubagentMessages',
      'maxSubagentMessageBytes',
      'maxCostMicros',
    ])
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'maxCostMicros') {
      if (entry === null || (Number.isSafeInteger(entry) && Number(entry) >= 0)) continue;
      throw new Error('VALIDATION_FAILED');
    }
    if (!positiveInteger(entry)) throw new Error('VALIDATION_FAILED');
  }
  return value as RunBudgetIncrease;
};

export const parseBudgetIncreaseRequest = (body: unknown): { increase: RunBudgetIncrease; expectedVersion: number } => {
  const value = versionedRecord(body, ['scope', 'refId', 'increase', 'expectedVersion']);
  if ((value.scope !== undefined && value.scope !== 'run') || value.refId !== undefined) {
    throw new Error('CAPABILITY_UNAVAILABLE');
  }
  if (!positiveInteger(value.expectedVersion)) throw new Error('VALIDATION_FAILED');
  return { increase: parseBudgetIncrease(value.increase), expectedVersion: value.expectedVersion };
};

const parseWorkspaceSpec = (value: unknown): AgentWorkspaceCreateSpec => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['recipeId', 'versions', 'runnerPluginIds', 'acpProfileIds', 'browserTargetId'])
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  if (typeof value.recipeId !== 'string' || value.recipeId.length < 1 || value.recipeId.length > 128) {
    throw new Error('VALIDATION_FAILED');
  }
  if (value.versions !== undefined) {
    if (!isRecord(value.versions) || Object.keys(value.versions).length > 32) throw new Error('VALIDATION_FAILED');
    if (Object.entries(value.versions).some(([key, entry]) => !key || typeof entry !== 'string' || !entry)) {
      throw new Error('VALIDATION_FAILED');
    }
  }
  if (value.runnerPluginIds !== undefined) {
    if (
      !Array.isArray(value.runnerPluginIds) ||
      value.runnerPluginIds.length > 32 ||
      new Set(value.runnerPluginIds).size !== value.runnerPluginIds.length ||
      value.runnerPluginIds.some(
        (pluginId) => typeof pluginId !== 'string' || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/.test(pluginId),
      )
    ) {
      throw new Error('VALIDATION_FAILED');
    }
  }
  if (value.acpProfileIds !== undefined) {
    if (
      !Array.isArray(value.acpProfileIds) ||
      value.acpProfileIds.length > 16 ||
      new Set(value.acpProfileIds).size !== value.acpProfileIds.length ||
      value.acpProfileIds.some((id) => typeof id !== 'string' || !/^[a-z][a-z0-9_.-]{0,127}$/.test(id))
    ) {
      throw new Error('VALIDATION_FAILED');
    }
  }
  if (
    value.browserTargetId !== undefined &&
    (typeof value.browserTargetId !== 'string' || !/^[a-z][a-z0-9_.-]{0,127}$/.test(value.browserTargetId))
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return value as unknown as AgentWorkspaceCreateSpec;
};

const parseRunEnvironmentSelection = (value: unknown): AgentRunEnvironmentSelection | null => {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error('VALIDATION_FAILED');
  const { catalogRevision, ...workspace } = value;
  if (
    catalogRevision !== undefined &&
    (typeof catalogRevision !== 'string' || !catalogRevision || catalogRevision.length > 128)
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  const parsed = parseWorkspaceSpec(workspace);
  return {
    ...parsed,
    ...(typeof catalogRevision === 'string' ? { catalogRevision } : {}),
  };
};

export const parseWorkspaceCreateRequest = (body: unknown): WorkspaceCreateRequestDto => {
  const value = versionedRecord(body, ['workspace', 'retained', 'catalogRevision']);
  if (
    (value.retained !== undefined && typeof value.retained !== 'boolean') ||
    (value.catalogRevision !== undefined &&
      (typeof value.catalogRevision !== 'string' || !value.catalogRevision || value.catalogRevision.length > 128))
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    workspace: parseWorkspaceSpec(value.workspace),
    retained: value.retained === true,
    ...(typeof value.catalogRevision === 'string' ? { catalogRevision: value.catalogRevision } : {}),
  };
};

export const parseWorkspaceActionRequest = (body: unknown): WorkspaceActionRequestDto => {
  const value = versionedRecord(body, ['action', 'expectedVersion']);
  if (
    !['start', 'stop', 'restart', 'delete'].includes(String(value.action)) ||
    !positiveInteger(value.expectedVersion)
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    action: value.action as WorkspaceActionRequestDto['action'],
    expectedVersion: value.expectedVersion,
  };
};

export const parseWorkspaceToolVersionsRequest = (body: unknown): WorkspaceToolVersionsRequestDto => {
  const value = versionedRecord(body, ['versions', 'expectedVersion', 'catalogRevision']);
  if (
    !isRecord(value.versions) ||
    Object.keys(value.versions).length < 1 ||
    Object.keys(value.versions).length > 32 ||
    Object.entries(value.versions).some(
      ([familyId, versionId]) =>
        !familyId || familyId.length > 128 || typeof versionId !== 'string' || !versionId || versionId.length > 128,
    ) ||
    !positiveInteger(value.expectedVersion) ||
    (value.catalogRevision !== undefined &&
      (typeof value.catalogRevision !== 'string' || !value.catalogRevision || value.catalogRevision.length > 128))
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    versions: value.versions as Record<string, string>,
    expectedVersion: value.expectedVersion,
    ...(typeof value.catalogRevision === 'string' ? { catalogRevision: value.catalogRevision } : {}),
  };
};

export const parseApprovalResolveRequest = (body: unknown): ApprovalResolveRequestDto => {
  const value = versionedRecord(body, ['decision', 'operationHash', 'expectedVersion']);
  if (
    (value.decision !== 'approved' && value.decision !== 'denied') ||
    typeof value.operationHash !== 'string' ||
    !/^v1:[a-f0-9]{64}$/.test(value.operationHash) ||
    !positiveInteger(value.expectedVersion)
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    decision: value.decision,
    operationHash: value.operationHash,
    expectedVersion: value.expectedVersion,
  };
};
