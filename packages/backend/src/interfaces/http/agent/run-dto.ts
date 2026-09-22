import type {
  AgentCheckpointViewDto,
  AgentDefinitionViewDto,
  AgentModelCapabilitySnapshotDto,
  AgentModelRefDto,
  AgentPendingRunInputPageDto,
  AgentRunEnvironmentSnapshotDto,
  AgentRunPageDto,
  AgentRunReconciliationViewDto,
  AgentRunSnapshotDto,
  AgentRunViewDto,
} from '@nexus-terminal/protocol/agent-runs';
import type { AgentRunFacade } from '../../../modules/agent/public';

type Definition = Awaited<ReturnType<AgentRunFacade['definitions']>>[number];
type RunView = Awaited<ReturnType<AgentRunFacade['create']>>;
type RunSnapshot = Awaited<ReturnType<AgentRunFacade['get']>>;
type RunPage = Awaited<ReturnType<AgentRunFacade['list']>>;
type Reconciliation = Awaited<ReturnType<AgentRunFacade['reconciliation']>>;
type Checkpoint = Awaited<ReturnType<AgentRunFacade['listCheckpoints']>>[number];
type PendingInputs = Awaited<ReturnType<AgentRunFacade['pendingInputs']>>;

const modelRefDto = (model: AgentModelRefDto): AgentModelRefDto => ({
  providerId: model.providerId,
  modelId: model.modelId,
  configurationVersion: model.configurationVersion,
});

const modelCapabilitySnapshotDto = (
  snapshot: AgentModelCapabilitySnapshotDto,
): AgentModelCapabilitySnapshotDto => ({
  contextWindow: snapshot.contextWindow,
  maxOutputTokens: snapshot.maxOutputTokens,
  supportsTools: snapshot.supportsTools,
  supportsImageInput: snapshot.supportsImageInput,
  supportsFileInput: snapshot.supportsFileInput,
  ...(snapshot.supportsPromptCacheKey === undefined
    ? {}
    : { supportsPromptCacheKey: snapshot.supportsPromptCacheKey }),
  ...(snapshot.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...snapshot.reasoningEfforts] }),
  ...(snapshot.defaultReasoningEffort === undefined
    ? {}
    : { defaultReasoningEffort: snapshot.defaultReasoningEffort }),
  ...(snapshot.reasoningMandatory === undefined ? {} : { reasoningMandatory: snapshot.reasoningMandatory }),
});

export const runEnvironmentDto = (
  environment: RunView['definition']['environment'],
): AgentRunEnvironmentSnapshotDto | null => {
  if (!environment) return null;
  return {
    kind: environment.kind,
    recipeId: environment.recipeId,
    recipeRevision: environment.recipeRevision,
    runtimeDigest: environment.runtimeDigest,
    catalogRevision: environment.catalogRevision,
    toolchain: environment.toolchain.map((pack) => ({
      familyId: pack.familyId,
      versionId: pack.versionId,
      contentDigest: pack.contentDigest,
    })),
    runnerPlugins: environment.runnerPlugins.map((plugin) => ({
      pluginId: plugin.pluginId,
      version: plugin.version,
      sdkVersion: plugin.sdkVersion,
      protocolVersion: 3,
      packageHash: plugin.packageHash,
      entry: plugin.entry,
    })),
    acpProfiles: environment.acpProfiles.map((profile) => ({
      id: profile.id,
      profileRevision: profile.profileRevision,
      argv: [...profile.argv],
      cwd: profile.cwd,
    })),
    browserTarget:
      environment.browserTarget === null
        ? null
        : {
            id: environment.browserTarget.id,
            profileRevision: environment.browserTarget.profileRevision,
            endpoints: environment.browserTarget.endpoints.map((endpoint) => ({ ...endpoint })),
            allowedUrlPatterns: [...environment.browserTarget.allowedUrlPatterns],
          },
  };
};

const planDto = (plan: RunView['plan']): AgentRunViewDto['plan'] => ({
  schemaVersion: 1,
  revision: plan.revision,
  items: plan.items.map((item) => ({
    id: item.id,
    title: item.title,
    detail: item.detail,
    status: item.status,
    dependsOn: [...item.dependsOn],
    evidenceRefs: [...item.evidenceRefs],
  })),
});

const goalDto = (goal: RunView['goal']): AgentRunViewDto['goal'] => ({
  text: goal.text,
  revision: goal.revision,
  updatedAt: goal.updatedAt,
});

export const definitionDto = (definition: Definition): AgentDefinitionViewDto => ({
  id: definition.id,
  version: definition.version,
  displayName: definition.displayName,
  description: definition.description,
  requiredModelCapabilities: [...definition.requiredModelCapabilities],
  modelCompatibility: definition.modelCompatibility.map((model) => ({
    providerId: model.providerId,
    modelId: model.modelId,
    configurationVersion: model.configurationVersion,
    compatible: model.compatible,
    missingCapabilities: [...model.missingCapabilities],
  })),
});

export const runDto = (run: RunView): AgentRunViewDto => ({
  id: run.id,
  userId: run.userId,
  appId: run.appId,
  threadId: run.threadId,
  parentRunId: run.parentRunId,
  status: run.status,
  goalStatus: run.goalStatus,
  goal: goalDto(run.goal),
  verificationStatus: run.verificationStatus,
  needsReconciliation: run.needsReconciliation,
  budget: {
    contextPolicy: { ...run.budget.contextPolicy },
    maxRunSteps: run.budget.maxRunSteps,
    maxActiveExecutionSeconds: run.budget.maxActiveExecutionSeconds,
    toolTimeoutSeconds: run.budget.toolTimeoutSeconds,
    maxToolOutputBytes: run.budget.maxToolOutputBytes,
    maxRecallItems: run.budget.maxRecallItems,
    maxRecallBytes: run.budget.maxRecallBytes,
    maxSubagentMessages: run.budget.maxSubagentMessages,
    maxSubagentMessageBytes: run.budget.maxSubagentMessageBytes,
    contextCompactionMode: run.budget.contextCompactionMode,
    revision: run.budget.revision,
  },
  definition: {
    schemaVersion: 1,
    agentDefinitionId: run.definition.agentDefinitionId,
    requiredModelCapabilities: [...run.definition.requiredModelCapabilities],
    model: modelRefDto(run.definition.model),
    modelCapabilities: modelCapabilitySnapshotDto(run.definition.modelCapabilities),
    rootModelRoutes: run.definition.rootModelRoutes.map((route) => ({
      model: modelRefDto(route.model),
      modelCapabilities: modelCapabilitySnapshotDto(route.modelCapabilities),
    })),
    ...(run.definition.reasoningEffort === undefined ? {} : { reasoningEffort: run.definition.reasoningEffort }),
    approvalMode: run.definition.approvalMode,
    executionMode: run.definition.executionMode,
    connectionIds: [...run.definition.connectionIds],
    environment: runEnvironmentDto(run.definition.environment),
    policyRevision: run.definition.policyRevision,
    settingsRevision: run.definition.settingsRevision,
    ...(run.definition.contextBoundary === undefined
      ? {}
      : {
          contextBoundary: {
            baseThrough: run.definition.contextBoundary.baseThrough,
            runThrough: { ...run.definition.contextBoundary.runThrough },
          },
        }),
  },
  plan: planDto(run.plan),
  usage: {
    inputTokens: run.usage.inputTokens,
    outputTokens: run.usage.outputTokens,
    cachedInputTokens: run.usage.cachedInputTokens,
    steps: run.usage.steps,
    subagentMessages: run.usage.subagentMessages,
    subagentMessageBytes: run.usage.subagentMessageBytes,
    ...(run.usage.context === undefined
      ? {}
      : {
          context: {
            inputTokens: run.usage.context.inputTokens,
            ...(run.usage.context.heuristicInputTokens === undefined
              ? {}
              : { heuristicInputTokens: run.usage.context.heuristicInputTokens }),
            reservedOutputTokens: run.usage.context.reservedOutputTokens,
            contextWindowTokens: run.usage.context.contextWindowTokens,
            source: run.usage.context.source,
            ...(run.usage.context.model === undefined ? {} : { model: modelRefDto(run.usage.context.model) }),
            ...(run.usage.context.contextEpoch === undefined
              ? {}
              : { contextEpoch: run.usage.context.contextEpoch }),
            updatedAt: run.usage.context.updatedAt,
          },
        }),
  },
  activeExecutionSeconds: run.activeExecutionSeconds,
  activeExecutionStartedAt: run.activeExecutionStartedAt,
  executingRuntimeCount: run.executingRuntimeCount,
  consumedInputSequence: run.consumedInputSequence,
  inputRevision: run.inputRevision,
  eventCursor: run.eventCursor,
  version: run.version,
  createdAt: run.createdAt,
  startedAt: run.startedAt,
  completedAt: run.completedAt,
  updatedAt: run.updatedAt,
});

export const runSnapshotDto = (run: RunSnapshot): AgentRunSnapshotDto => ({
  ...runDto(run),
  terminalIssue:
    run.terminalIssue === null
      ? null
      : {
          eventType: run.terminalIssue.eventType,
          errorCode: run.terminalIssue.errorCode,
          reason: run.terminalIssue.reason,
          occurredAt: run.terminalIssue.occurredAt,
        },
  pendingInputRequest:
    run.pendingInputRequest === null
      ? null
      : {
          id: run.pendingInputRequest.id,
          runtimeId: run.pendingInputRequest.runtimeId,
          questions: run.pendingInputRequest.questions.map((question) => ({
            id: question.id,
            prompt: question.prompt,
            kind: question.kind,
            ...(question.choices === undefined
              ? {}
              : {
                  choices: question.choices.map((choice) => ({
                    value: choice.value,
                    label: choice.label,
                    ...(choice.description === undefined ? {} : { description: choice.description }),
                  })),
                }),
            ...(question.recommendedChoice === undefined
              ? {}
              : { recommendedChoice: question.recommendedChoice }),
            ...(question.context === undefined ? {} : { context: question.context }),
          })),
          requestedAt: run.pendingInputRequest.requestedAt,
        },
  recentEntries: run.recentEntries.map((entry) => ({
    id: entry.id,
    sequence: entry.sequence,
    kind: entry.kind,
    payload: entry.payload,
    createdAt: entry.createdAt,
  })),
});

export const runPageDto = (page: RunPage): AgentRunPageDto => ({
  items: page.items.map(runDto),
  nextCursor: page.nextCursor,
});

export const reconciliationDto = (view: Reconciliation): AgentRunReconciliationViewDto => ({
  runId: view.runId,
  required: view.required,
  resources: view.resources.map((resource) => ({ ...resource })),
});

export const pendingInputsDto = (page: PendingInputs): AgentPendingRunInputPageDto => ({
  items: page.items.map((item) => ({
    id: item.id,
    sequence: item.sequence,
    text: item.text,
    artifactRefs: [...item.artifactRefs],
    createdAt: item.createdAt,
  })),
  total: page.total,
  hasMore: page.hasMore,
});

export const checkpointDto = (checkpoint: Checkpoint): AgentCheckpointViewDto => ({
  id: checkpoint.id,
  runId: checkpoint.runId,
  kind: checkpoint.kind,
  schemaVersion: 1,
  ledgerThrough: checkpoint.ledgerThrough,
  eventThrough: checkpoint.eventThrough,
  snapshot: {
    schemaVersion: 1,
    runId: checkpoint.snapshot.runId,
    ledgerThrough: checkpoint.snapshot.ledgerThrough,
    planVersion: checkpoint.snapshot.planVersion,
    inputRevision: checkpoint.snapshot.inputRevision,
    settingsRevision: checkpoint.snapshot.settingsRevision,
    plan: planDto(checkpoint.snapshot.plan),
    goal: goalDto(checkpoint.snapshot.goal),
    completedStepIds: [...checkpoint.snapshot.completedStepIds],
    evidenceRefs: [...checkpoint.snapshot.evidenceRefs],
    checkpointArtifactRefs: [...checkpoint.snapshot.checkpointArtifactRefs],
    modelConfigurationVersion: checkpoint.snapshot.modelConfigurationVersion,
    activeModel: modelRefDto(checkpoint.snapshot.activeModel),
    definitionVersion: checkpoint.snapshot.definitionVersion,
    policyRevision: checkpoint.snapshot.policyRevision,
    workspaceArtifactManifestRefs: [...checkpoint.snapshot.workspaceArtifactManifestRefs],
    workspaceArtifactRefs: [...checkpoint.snapshot.workspaceArtifactRefs],
    recoveryManifest: {
      schemaVersion: 1,
      eventThrough: checkpoint.snapshot.recoveryManifest.eventThrough,
      contextBoundary: {
        baseThrough: checkpoint.snapshot.recoveryManifest.contextBoundary.baseThrough,
        runThrough: { ...checkpoint.snapshot.recoveryManifest.contextBoundary.runThrough },
      },
      tools: checkpoint.snapshot.recoveryManifest.tools.map((tool) => ({
        toolCallId: tool.toolCallId,
        operationHash: tool.operationHash,
        risk: tool.risk,
        status: tool.status,
        sideEffectStatus: tool.sideEffectStatus,
        verificationStatus: tool.verificationStatus,
        quarantinedResourceKeys: [...tool.quarantinedResourceKeys],
      })),
      delegations: checkpoint.snapshot.recoveryManifest.delegations.map((delegation) => ({ ...delegation })),
      backgroundJobs: checkpoint.snapshot.recoveryManifest.backgroundJobs.map((job) => ({ ...job })),
      quarantinedResourceKeys: [...checkpoint.snapshot.recoveryManifest.quarantinedResourceKeys],
    },
  },
  createdAt: checkpoint.createdAt,
});
