import type {
  AgentSubagentMessageDto,
  AgentSubagentSettingsViewDto,
  AgentSubagentViewDto,
} from '@nexus-terminal/protocol/agent-collaboration';
import type { AgentCollaborationFacade } from '../../../modules/agent/public';

type SettingsView = Awaited<ReturnType<AgentCollaborationFacade['getSettings']>>;
type Delegation = Awaited<ReturnType<AgentCollaborationFacade['cancelSubagent']>>;
type Message = Awaited<ReturnType<AgentCollaborationFacade['listSubagentMessages']>>[number];

const modelRefDto = (model: Delegation['modelRef']) => ({
  providerId: model.providerId,
  modelId: model.modelId,
  configurationVersion: model.configurationVersion,
});

const modelCapabilitiesDto = (model: Delegation['modelCapabilities']) => ({
  contextWindow: model.contextWindow,
  maxOutputTokens: model.maxOutputTokens,
  supportsTools: model.supportsTools,
  supportsImageInput: model.supportsImageInput,
  supportsFileInput: model.supportsFileInput,
  ...(model.supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey: model.supportsPromptCacheKey }),
  ...(model.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...model.reasoningEfforts] }),
  ...(model.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: model.defaultReasoningEffort }),
  ...(model.reasoningMandatory === undefined ? {} : { reasoningMandatory: model.reasoningMandatory }),
});

const profileDto = (profile: SettingsView['policy']['profiles'][number]) => ({
  id: profile.id,
  role: profile.role,
  defaultModel: profile.defaultModel === null ? null : modelRefDto(profile.defaultModel as Delegation['modelRef']),
  allowedModels: profile.allowedModels.map((model) => modelRefDto(model as Delegation['modelRef'])),
  capabilities: [...profile.capabilities],
  peerMessaging: profile.peerMessaging,
  mutationMode: profile.mutationMode,
  maxSteps: profile.maxSteps,
  failureMode: profile.failureMode,
});

export const subagentSettingsDto = (view: SettingsView): AgentSubagentSettingsViewDto => ({
  policy: {
    maxDelegationDepth: view.policy.maxDelegationDepth,
    maxMessagesPerRun: view.policy.maxMessagesPerRun,
    maxMessageBytesPerRun: view.policy.maxMessageBytesPerRun,
    profiles: view.policy.profiles.map(profileDto),
  },
  templates: view.templates.map((template) => ({
    id: template.id,
    role: template.role,
    delegationHint: template.delegationHint,
    capabilities: [...template.capabilities],
    peerMessaging: template.peerMessaging,
    mutationMode: template.mutationMode,
    maxSteps: template.maxSteps,
    failureMode: template.failureMode,
  })),
  version: view.version,
});

export const subagentDto = (delegation: Delegation): AgentSubagentViewDto => ({
  id: delegation.id,
  userId: delegation.userId,
  appId: delegation.appId,
  runId: delegation.runId,
  parentRuntimeId: delegation.parentRuntimeId,
  childRuntimeId: delegation.childRuntimeId,
  profileId: delegation.profileId,
  grants: delegation.grants.map((grant) => ({
    capability: grant.capability,
    schemaVersion: 2,
    scope:
      grant.scope.kind === 'global'
        ? { kind: 'global' }
        : {
            kind: 'targets',
            targets: Object.fromEntries(
              Object.entries(grant.scope.targets).map(([target, selection]) => [
                target,
                selection?.mode === 'all' ? { mode: 'all' } : { mode: 'ids', ids: [...(selection?.ids ?? [])] },
              ]),
            ),
          },
  })),
  peerMessaging: delegation.peerMessaging,
  mutationMode: delegation.mutationMode,
  modelRef: modelRefDto(delegation.modelRef),
  modelCapabilities: modelCapabilitiesDto(delegation.modelCapabilities),
  objective: delegation.objective,
  constraints: [...delegation.constraints],
  inputArtifactRefs: [...delegation.inputArtifactRefs],
  completionCriteria: [...delegation.completionCriteria],
  dependencyMode: delegation.dependencyMode,
  status: delegation.status,
  depth: delegation.depth,
  failureMode: delegation.failureMode,
  budget: { maxSteps: delegation.budget.maxSteps },
  usage: { tokens: delegation.usage.tokens, steps: delegation.usage.steps },
  result: delegation.result,
  evidenceRefs: [...delegation.evidenceRefs],
  deadlineAt: delegation.deadlineAt,
  version: delegation.version,
  createdAt: delegation.createdAt,
  updatedAt: delegation.updatedAt,
  completedAt: delegation.completedAt,
});

export const subagentMessageDto = (message: Message): AgentSubagentMessageDto => ({
  id: message.id,
  runId: message.runId,
  senderRuntimeId: message.senderRuntimeId,
  recipientRuntimeId: message.recipientRuntimeId,
  delegationId: message.delegationId,
  recipientSequence: message.recipientSequence,
  kind: message.kind,
  correlationId: message.correlationId,
  replyTo: message.replyTo,
  causationId: message.causationId,
  taskRevision: message.taskRevision,
  body: message.body,
  artifactRefs: [...message.artifactRefs],
  status: message.status,
  createdAt: message.createdAt,
  expiresAt: message.expiresAt,
  consumedAt: message.consumedAt,
});
