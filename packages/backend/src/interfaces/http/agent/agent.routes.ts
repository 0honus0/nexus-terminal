import type {
  AgentArtifactAttachRequestDto,
  AgentArtifactCleanupConfirmRequestDto,
  AgentArtifactFileKindDto,
  AgentArtifactLibraryQueryDto,
} from '@nexus-terminal/protocol/agent-artifacts';
import type {
  AgentAppGrantReplaceRequestDto,
  AgentAppStateUpdateRequestDto,
  AgentCapabilityGrantInputDto,
  AgentCapabilityScopeDto,
  AgentExecutionPolicyOverridesDto,
  AgentExecutionPolicyReplaceRequestDto,
  AgentHardLimitConfirmRequestDto,
  AgentHardLimitPreviewRequestDto,
  AgentHardLimitsDto,
  AgentRecommendedPluginInstallRequestDto,
  AgentTargetDenylistReplaceRequestDto,
  AgentSettingsPatchDto,
  AgentSettingsPatchRequestDto,
  AgentTargetGrantSelectionDto,
} from '@nexus-terminal/protocol/agent-host';
import type {
  AgentAppIntentCreateRequestDto,
  AgentAppIntentListQueryDto,
  AgentAppIntentRevokeResponseDto,
} from '@nexus-terminal/protocol/agent-plugins';
import type {
  AgentAvailableModelDto,
  AgentDiscoverEndpointModelsRequestDto,
  AgentDiscoveredProviderModelDto,
  AgentModelRegistryResolveQueryDto,
  AgentModelRegistryResolveResponseDto,
  AgentModelRegistryStatusDto,
  AgentModelRegistryUpdateRequestDto,
  AgentProviderCreateRequestDto,
  AgentProviderDeleteQueryDto,
  AgentProviderDeleteResponseDto,
  AgentProviderModelDto,
  AgentProviderModelInputDto,
  AgentProviderPatchFieldsDto,
  AgentProviderPatchRequestDto,
  AgentProviderTestRequestDto,
  AgentProviderTestResponseDto,
  AgentProviderViewDto,
  AgentReasoningEffortDto,
} from '@nexus-terminal/protocol/agent-providers';
import { Router } from 'express';
import { create as createContentDisposition } from 'content-disposition';
import parseRange from 'range-parser';
import {
  AGENT_CAPABILITIES,
  resolveAgentAvailability,
  type AgentArtifactFacade,
  type AgentCapability,
  type AgentEventFacade,
  type AgentWorkspaceRuntimeFacade,
  type AgentHostFacade,
  type AgentPluginFacade,
  type AgentProviderFacade,
  type AgentModelRegistryFacade,
} from '../../../modules/agent/public';
import { agentData, agentError, agentRoute } from './agent-http';
import {
  artifactAttachResponseDto,
  artifactCleanupPreviewDto,
  artifactCleanupResultDto,
  artifactPageDto,
  artifactStorageSummaryDto,
} from './artifact-dto';
import { appIntentArtifactDto, appIntentReceiptDto } from './plugin-dto';
import {
  appGrantViewDto,
  appSummaryDto,
  executionPolicyDto,
  hardLimitPreviewDto,
  hostSummaryDto,
  recommendedPluginDto,
  recommendedPluginInstallResultDto,
  settingsViewDto,
  targetDenylistDto,
} from './agent-host-dto';
import {
  hasOnlyKeys,
  isJsonValue,
  isRecord,
  nonEmptyString,
  pathParam,
  positiveInteger,
  queryString,
} from './agent-route-input';
import { agentUserId, createAgentMutationSecurity, issueAgentCsrf, requireAgentAuthenticated } from './agent-security';
import { createPluginRouter } from './plugins.routes';
import { createWorkspaceRuntimeRouter } from './workspace-runtime.routes';

export interface AgentRouterDependencies {
  host: AgentHostFacade;
  plugins: AgentPluginFacade;
  providers: AgentProviderFacade;
  modelRegistry: AgentModelRegistryFacade;
  artifacts: AgentArtifactFacade;
  events: AgentEventFacade;
  workspaceRuntime: AgentWorkspaceRuntimeFacade;
  nodeEnv: string;
  publicOrigin?: string;
  csrfSecret: string;
}

const appIntentRangeFor = (
  header: string | undefined,
  sizeBytes: number,
): { start: number; endInclusive: number; partial: boolean } => {
  if (sizeBytes === 0) return { start: 0, endInclusive: -1, partial: false };
  if (!header) {
    return { start: 0, endInclusive: Math.min(sizeBytes - 1, 1024 * 1024 - 1), partial: sizeBytes > 1024 * 1024 };
  }
  const parsed = parseRange(sizeBytes, header, { combine: false });
  if (parsed === -1 || parsed === -2 || parsed.type !== 'bytes' || parsed.length !== 1) {
    throw new Error('APP_INTENT_ARTIFACT_RANGE_INVALID');
  }
  const requested = parsed[0]!;
  const start = requested.start;
  const openEnded = /^bytes=\d+-$/.test(header.trim());
  const endInclusive = openEnded ? Math.min(requested.end, start + 8 * 1024 * 1024 - 1) : requested.end;
  if (endInclusive - start + 1 > 8 * 1024 * 1024) throw new Error('APP_INTENT_ARTIFACT_RANGE_INVALID');
  return { start, endInclusive, partial: true };
};

const appIntentContentDisposition = (name: string): string =>
  createContentDisposition(name.slice(0, 180) || 'artifact', { type: 'attachment' });

const settingsPatchRequest = (value: unknown): AgentSettingsPatchRequestDto => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['patch', 'expectedVersion'])) throw new Error('VALIDATION_FAILED');
  if (!isRecord(value.patch) || !positiveInteger(value.expectedVersion)) throw new Error('VALIDATION_FAILED');
  const allowedSections = new Set([
    'feature',
    'model',
    'performance',
    'budget',
    'subagents',
    'storage',
    'workspaceRuntime',
    'browser',
    'plugins',
  ]);
  if (Object.keys(value.patch).some((key) => !allowedSections.has(key))) throw new Error('VALIDATION_FAILED');
  const patch: AgentSettingsPatchDto = {};
  for (const section of allowedSections) {
    if (!(section in value.patch)) continue;
    const candidate = value.patch[section];
    if (!isRecord(candidate)) throw new Error('VALIDATION_FAILED');
    (patch as Record<string, unknown>)[section] = { ...candidate };
  }
  return { patch, expectedVersion: value.expectedVersion };
};

const hardLimitKeys = [
  'maxRunSteps',
  'maxActiveExecutionSeconds',
  'toolTimeoutSeconds',
  'maxToolOutputBytes',
  'maxArtifactBytes',
  'maxSingleArtifactBytes',
  'maxGlobalArtifactBytes',
  'maxRecallItems',
  'maxRecallBytes',
  'maxConcurrentRuntimes',
  'maxConcurrentModelCalls',
  'maxDelegationDepth',
  'maxSubagentMessagesPerRun',
  'maxSubagentMessageBytesPerRun',
  'maxActiveWorkspaces',
  'unretainedArtifactTtlSeconds',
] as const satisfies readonly (keyof AgentHardLimitsDto)[];

const hardLimitPreviewRequest = (value: unknown): AgentHardLimitPreviewRequestDto => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['proposed', 'expectedVersion'])) throw new Error('VALIDATION_FAILED');
  if (!isRecord(value.proposed) || !positiveInteger(value.expectedVersion)) throw new Error('VALIDATION_FAILED');
  if (Object.keys(value.proposed).some((key) => !hardLimitKeys.includes(key as keyof AgentHardLimitsDto))) {
    throw new Error('VALIDATION_FAILED');
  }
  const proposed: Partial<AgentHardLimitsDto> = {};
  for (const key of hardLimitKeys) {
    const candidate = value.proposed[key];
    if (candidate === undefined) continue;
    if (!positiveInteger(candidate)) throw new Error('VALIDATION_FAILED');
    proposed[key] = candidate;
  }
  return { proposed, expectedVersion: value.expectedVersion };
};

const hardLimitConfirmRequest = (value: unknown): AgentHardLimitConfirmRequestDto => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['confirmationId', 'expectedVersion'])) {
    throw new Error('VALIDATION_FAILED');
  }
  if (!nonEmptyString(value.confirmationId) || !positiveInteger(value.expectedVersion)) {
    throw new Error('VALIDATION_FAILED');
  }
  return { confirmationId: value.confirmationId, expectedVersion: value.expectedVersion };
};

const appStateUpdateRequest = (value: unknown): AgentAppStateUpdateRequestDto => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['enabled', 'expectedVersion'])) throw new Error('VALIDATION_FAILED');
  if (typeof value.enabled !== 'boolean' || !positiveInteger(value.expectedVersion))
    throw new Error('VALIDATION_FAILED');
  return { enabled: value.enabled, expectedVersion: value.expectedVersion };
};

const grantSelection = (value: unknown): AgentTargetGrantSelectionDto => {
  if (!isRecord(value)) throw new Error('VALIDATION_FAILED');
  if (value.mode === 'all' && hasOnlyKeys(value, ['mode'])) return { mode: 'all' };
  if (
    value.mode === 'ids' &&
    hasOnlyKeys(value, ['mode', 'ids']) &&
    Array.isArray(value.ids) &&
    value.ids.every((id) => typeof id === 'string' && id.length > 0)
  ) {
    return { mode: 'ids', ids: [...value.ids] };
  }
  throw new Error('VALIDATION_FAILED');
};

const capabilityScope = (value: unknown): AgentCapabilityScopeDto => {
  if (!isRecord(value)) throw new Error('VALIDATION_FAILED');
  if (value.kind === 'global' && hasOnlyKeys(value, ['kind'])) return { kind: 'global' };
  if (value.kind !== 'targets' || !hasOnlyKeys(value, ['kind', 'targets']) || !isRecord(value.targets)) {
    throw new Error('VALIDATION_FAILED');
  }
  if (Object.keys(value.targets).some((key) => key !== 'workspace' && key !== 'ssh')) {
    throw new Error('VALIDATION_FAILED');
  }
  const targets: AgentCapabilityScopeDto & { kind: 'targets' } = { kind: 'targets', targets: {} };
  if (value.targets.workspace !== undefined) targets.targets.workspace = grantSelection(value.targets.workspace);
  if (value.targets.ssh !== undefined) targets.targets.ssh = grantSelection(value.targets.ssh);
  return targets;
};

const grantInput = (value: unknown): AgentCapabilityGrantInputDto => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['capability', 'scope'])) throw new Error('VALIDATION_FAILED');
  if (typeof value.capability !== 'string' || !AGENT_CAPABILITIES.includes(value.capability as AgentCapability)) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    capability: value.capability as AgentCapabilityGrantInputDto['capability'],
    scope: capabilityScope(value.scope),
  };
};

const appGrantReplaceRequest = (value: unknown): AgentAppGrantReplaceRequestDto => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['grants', 'expectedPolicyRevision'])) {
    throw new Error('VALIDATION_FAILED');
  }
  if (
    !Array.isArray(value.grants) ||
    value.grants.length > AGENT_CAPABILITIES.length ||
    !positiveInteger(value.expectedPolicyRevision)
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  const grants = value.grants.map(grantInput);
  if (new Set(grants.map((grant) => grant.capability)).size !== grants.length) throw new Error('VALIDATION_FAILED');
  return { grants, expectedPolicyRevision: value.expectedPolicyRevision };
};

const executionPolicyReplaceRequest = (value: unknown): AgentExecutionPolicyReplaceRequestDto => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['overrides', 'expectedVersion']) || !isRecord(value.overrides)) {
    throw new Error('VALIDATION_FAILED');
  }
  if (!Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 0)
    throw new Error('VALIDATION_FAILED');
  const overrides = { ...value.overrides } as AgentExecutionPolicyOverridesDto;
  return { overrides, expectedVersion: Number(value.expectedVersion) };
};

const artifactFileKinds: readonly AgentArtifactFileKindDto[] = [
  'image',
  'document',
  'code',
  'archive',
  'media',
  'other',
];

const artifactFileKind = (value: string | undefined): AgentArtifactFileKindDto | undefined => {
  if (value === undefined) return undefined;
  if ((artifactFileKinds as readonly string[]).includes(value)) return value as AgentArtifactFileKindDto;
  throw new Error('VALIDATION_FAILED');
};

const providerInputKeys = [
  'kind',
  'displayName',
  'baseUrl',
  'protocol',
  'credential',
  'clearCredential',
  'models',
  'enabled',
] as const;
const reasoningEfforts = new Set<AgentReasoningEffortDto>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

type ProviderView = Awaited<ReturnType<AgentProviderFacade['get']>>;
type DiscoveredProviderModel = Awaited<ReturnType<AgentProviderFacade['discoverModels']>>[number];
type ProviderTestResult = Awaited<ReturnType<AgentProviderFacade['test']>>;

const providerModelInput = (value: unknown): AgentProviderModelInputDto => {
  if (!isRecord(value)) throw new Error('VALIDATION_FAILED');
  const allowed = [
    'id',
    'contextWindow',
    'maxOutputTokens',
    'supportsTools',
    'supportsImageInput',
    'supportsFileInput',
    'supportsPromptCacheKey',
    'reasoningEfforts',
    'defaultReasoningEffort',
    'reasoningMandatory',
  ] as const;
  if (!hasOnlyKeys(value, allowed)) throw new Error('VALIDATION_FAILED');
  if (
    !nonEmptyString(value.id) ||
    !positiveInteger(value.contextWindow) ||
    !positiveInteger(value.maxOutputTokens) ||
    typeof value.supportsTools !== 'boolean' ||
    (value.supportsImageInput !== undefined && typeof value.supportsImageInput !== 'boolean') ||
    (value.supportsFileInput !== undefined && typeof value.supportsFileInput !== 'boolean') ||
    (value.supportsPromptCacheKey !== undefined && typeof value.supportsPromptCacheKey !== 'boolean') ||
    (value.reasoningMandatory !== undefined && typeof value.reasoningMandatory !== 'boolean')
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  let parsedEfforts: AgentReasoningEffortDto[] | undefined;
  if (value.reasoningEfforts !== undefined) {
    if (
      !Array.isArray(value.reasoningEfforts) ||
      value.reasoningEfforts.some(
        (effort) => typeof effort !== 'string' || !reasoningEfforts.has(effort as AgentReasoningEffortDto),
      )
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    parsedEfforts = [...value.reasoningEfforts] as AgentReasoningEffortDto[];
  }
  if (
    value.defaultReasoningEffort !== undefined &&
    (typeof value.defaultReasoningEffort !== 'string' ||
      !reasoningEfforts.has(value.defaultReasoningEffort as AgentReasoningEffortDto))
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    id: value.id,
    contextWindow: value.contextWindow,
    maxOutputTokens: value.maxOutputTokens,
    supportsTools: value.supportsTools,
    ...(value.supportsImageInput === undefined ? {} : { supportsImageInput: value.supportsImageInput }),
    ...(value.supportsFileInput === undefined ? {} : { supportsFileInput: value.supportsFileInput }),
    ...(value.supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey: value.supportsPromptCacheKey }),
    ...(parsedEfforts === undefined ? {} : { reasoningEfforts: parsedEfforts }),
    ...(value.defaultReasoningEffort === undefined
      ? {}
      : { defaultReasoningEffort: value.defaultReasoningEffort as AgentReasoningEffortDto }),
    ...(value.reasoningMandatory === undefined ? {} : { reasoningMandatory: value.reasoningMandatory }),
  };
};

const providerModelsInput = (value: unknown): AgentProviderModelInputDto[] => {
  if (!Array.isArray(value)) throw new Error('VALIDATION_FAILED');
  return value.map(providerModelInput);
};

const providerCreateInput = (value: unknown): AgentProviderCreateRequestDto => {
  if (!isRecord(value) || !hasOnlyKeys(value, providerInputKeys)) throw new Error('VALIDATION_FAILED');
  if (
    value.kind !== 'openai-compatible' ||
    typeof value.displayName !== 'string' ||
    typeof value.baseUrl !== 'string' ||
    (value.protocol !== 'chat-completions' && value.protocol !== 'responses') ||
    typeof value.enabled !== 'boolean' ||
    (value.credential !== undefined && typeof value.credential !== 'string') ||
    (value.clearCredential !== undefined && typeof value.clearCredential !== 'boolean')
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    kind: 'openai-compatible',
    displayName: value.displayName,
    baseUrl: value.baseUrl,
    protocol: value.protocol,
    ...(value.credential === undefined ? {} : { credential: value.credential }),
    ...(value.clearCredential === undefined ? {} : { clearCredential: value.clearCredential }),
    models: providerModelsInput(value.models),
    enabled: value.enabled,
  };
};

const providerPatchRequest = (value: unknown): AgentProviderPatchRequestDto => {
  if (!isRecord(value) || !hasOnlyKeys(value, [...providerInputKeys, 'expectedVersion'])) {
    throw new Error('VALIDATION_FAILED');
  }
  if (!positiveInteger(value.expectedVersion)) throw new Error('VALIDATION_FAILED');
  const fields: AgentProviderPatchFieldsDto = {};
  if (value.kind !== undefined) {
    if (value.kind !== 'openai-compatible') throw new Error('VALIDATION_FAILED');
    fields.kind = value.kind;
  }
  if (value.displayName !== undefined) {
    if (typeof value.displayName !== 'string') throw new Error('VALIDATION_FAILED');
    fields.displayName = value.displayName;
  }
  if (value.baseUrl !== undefined) {
    if (typeof value.baseUrl !== 'string') throw new Error('VALIDATION_FAILED');
    fields.baseUrl = value.baseUrl;
  }
  if (value.protocol !== undefined) {
    if (value.protocol !== 'chat-completions' && value.protocol !== 'responses') throw new Error('VALIDATION_FAILED');
    fields.protocol = value.protocol;
  }
  if (value.credential !== undefined) {
    if (typeof value.credential !== 'string') throw new Error('VALIDATION_FAILED');
    fields.credential = value.credential;
  }
  if (value.clearCredential !== undefined) {
    if (typeof value.clearCredential !== 'boolean') throw new Error('VALIDATION_FAILED');
    fields.clearCredential = value.clearCredential;
  }
  if (value.models !== undefined) fields.models = providerModelsInput(value.models);
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') throw new Error('VALIDATION_FAILED');
    fields.enabled = value.enabled;
  }
  return { ...fields, expectedVersion: value.expectedVersion };
};

const providerPatchInput = async (
  providers: AgentProviderFacade,
  currentUserId: number,
  providerId: string,
  value: unknown,
): Promise<{ expectedVersion: number; input: AgentProviderCreateRequestDto }> => {
  const patch = providerPatchRequest(value);
  const current = await providers.get(currentUserId, providerId);
  return {
    expectedVersion: patch.expectedVersion,
    input: {
      kind: patch.kind ?? current.kind,
      displayName: patch.displayName ?? current.displayName,
      baseUrl: patch.baseUrl ?? current.baseUrl,
      protocol: patch.protocol ?? current.protocol,
      models: patch.models ?? current.models,
      enabled: patch.enabled ?? current.enabled,
      ...(patch.credential === undefined ? {} : { credential: patch.credential }),
      ...(patch.clearCredential === undefined ? {} : { clearCredential: patch.clearCredential }),
    },
  };
};

const providerModelDto = (model: ProviderView['models'][number]): AgentProviderModelDto => ({
  id: model.id,
  contextWindow: model.contextWindow,
  maxOutputTokens: model.maxOutputTokens,
  supportsTools: model.supportsTools,
  supportsImageInput: model.supportsImageInput,
  supportsFileInput: model.supportsFileInput,
  ...(model.supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey: model.supportsPromptCacheKey }),
  capabilitySources: { ...model.capabilitySources },
  ...(model.registryDefaults === undefined ? {} : { registryDefaults: model.registryDefaults }),
  ...(model.providerCapabilities === undefined ? {} : { providerCapabilities: model.providerCapabilities }),
  ...(model.capabilityConflicts === undefined ? {} : { capabilityConflicts: [...model.capabilityConflicts] }),
  ...(model.capabilityOverrides === undefined ? {} : { capabilityOverrides: model.capabilityOverrides }),
  ...(model.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...model.reasoningEfforts] }),
  ...(model.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: model.defaultReasoningEffort }),
  ...(model.reasoningSource === undefined ? {} : { reasoningSource: model.reasoningSource }),
  ...(model.reasoningMandatory === undefined ? {} : { reasoningMandatory: model.reasoningMandatory }),
});

const providerDto = (provider: ProviderView): AgentProviderViewDto => ({
  id: provider.id,
  kind: provider.kind,
  displayName: provider.displayName,
  baseUrl: provider.baseUrl,
  protocol: provider.protocol,
  hasCredential: provider.hasCredential,
  credentialRevision: provider.credentialRevision,
  models: provider.models.map(providerModelDto),
  enabled: provider.enabled,
  version: provider.version,
  createdAt: provider.createdAt,
  updatedAt: provider.updatedAt,
});

const discoveredProviderModelDto = (model: DiscoveredProviderModel): AgentDiscoveredProviderModelDto => ({
  id: model.id,
  ...(model.ownedBy === undefined ? {} : { ownedBy: model.ownedBy }),
  ...(model.createdAt === undefined ? {} : { createdAt: model.createdAt }),
  ...(model.registryDefaults === undefined ? {} : { registryDefaults: model.registryDefaults }),
  ...(model.providerCapabilities === undefined ? {} : { providerCapabilities: model.providerCapabilities }),
  ...(model.liveCapabilityReport === undefined ? {} : { liveCapabilityReport: model.liveCapabilityReport }),
});

const providerTestDto = (result: ProviderTestResult): AgentProviderTestResponseDto => ({
  ok: result.ok,
  latencyMs: result.latencyMs,
  ...(result.usage === undefined ? {} : { usage: result.usage }),
  ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
});

const modelRegistryStatusDto = (
  status: ReturnType<AgentModelRegistryFacade['status']>,
): AgentModelRegistryStatusDto => ({
  sourceUrl: status.sourceUrl,
  autoUpdate: status.autoUpdate,
  activeSource: status.activeSource,
  entryCount: status.entryCount,
  generatedAt: status.generatedAt,
  sourceRevision: status.sourceRevision,
  builtinGeneratedAt: status.builtinGeneratedAt,
  lastAttemptAt: status.lastAttemptAt,
  lastSuccessAt: status.lastSuccessAt,
  lastErrorCode: status.lastErrorCode,
  nextAutoUpdateAt: status.nextAutoUpdateAt,
});

export const createAgentRouter = (dependencies: AgentRouterDependencies): Router => {
  const router = Router();
  const mutationSecurity = createAgentMutationSecurity({
    nodeEnv: dependencies.nodeEnv,
    publicOrigin: dependencies.publicOrigin,
    csrfSecret: dependencies.csrfSecret,
  });

  router.use(requireAgentAuthenticated);

  router.get(
    '/security/csrf',
    agentRoute(async (request, response) => issueAgentCsrf(request, response, dependencies.csrfSecret)),
  );

  router.use('/plugins', createPluginRouter(dependencies.plugins, mutationSecurity));

  router.get(
    '/apps',
    agentRoute(async (request, response) => {
      const apps = await dependencies.host.listApps(agentUserId(request));
      agentData(request, response, apps.map(appSummaryDto));
    }),
  );

  router.get(
    '/apps/:appId/grants',
    agentRoute(async (request, response) => {
      const userId = agentUserId(request);
      const appId = pathParam(request.params.appId);
      const [app, grants] = await Promise.all([
        dependencies.host.getApp(userId, appId),
        dependencies.host.listAppGrants(userId, appId),
      ]);
      const declared = new Set(app.capabilities);
      const definitions = dependencies.host
        .listCapabilityDefinitions()
        .filter((definition) => declared.has(definition.id));
      agentData(request, response, appGrantViewDto(app, definitions, grants));
    }),
  );

  router.put(
    '/apps/:appId/grants',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = appGrantReplaceRequest(request.body);
      const updated = await dependencies.host.replaceAppGrants(
        agentUserId(request),
        pathParam(request.params.appId),
        input.grants,
        input.expectedPolicyRevision,
      );
      const definitions = dependencies.host
        .listCapabilityDefinitions()
        .filter((definition) => updated.app.capabilities.includes(definition.id));
      agentData(request, response, appGrantViewDto(updated.app, definitions, updated.grants));
    }),
  );

  router.post(
    '/apps/:appId/plugin-intents',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['receiverAppId', 'intentId', 'input', 'artifactRefs', 'confirmed']) ||
        !nonEmptyString(request.body.receiverAppId) ||
        !nonEmptyString(request.body.intentId) ||
        !isJsonValue(request.body.input) ||
        !Array.isArray(request.body.artifactRefs) ||
        request.body.artifactRefs.length > 16 ||
        request.body.confirmed !== true
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const artifactRefs: AgentAppIntentCreateRequestDto['artifactRefs'] = [];
      for (const candidate of request.body.artifactRefs) {
        if (
          !isRecord(candidate) ||
          !hasOnlyKeys(candidate, ['appId', 'id']) ||
          !nonEmptyString(candidate.appId) ||
          !nonEmptyString(candidate.id)
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        artifactRefs.push({ appId: candidate.appId, id: candidate.id });
      }
      const input: AgentAppIntentCreateRequestDto = {
        receiverAppId: request.body.receiverAppId,
        intentId: request.body.intentId,
        input: request.body.input,
        artifactRefs,
        confirmed: true,
      };
      const receipt = await dependencies.host.createAppIntent(
        { userId: agentUserId(request), appId: pathParam(request.params.appId) },
        input,
      );
      agentData(request, response, appIntentReceiptDto(receipt), 201);
    }),
  );

  router.get(
    '/apps/:appId/execution-policy',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(request, response, executionPolicyDto(await dependencies.host.getAppExecutionPolicy(scope)));
    }),
  );

  router.put(
    '/apps/:appId/execution-policy',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = executionPolicyReplaceRequest(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        executionPolicyDto(
          await dependencies.host.replaceAppExecutionPolicy(scope, input.overrides, input.expectedVersion),
        ),
      );
    }),
  );

  router.get(
    '/apps/:appId/plugin-intents',
    agentRoute(async (request, response) => {
      const rawLimit = queryString(request.query.limit);
      const limit = rawLimit === undefined ? undefined : Number(rawLimit);
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)) {
        throw new Error('VALIDATION_FAILED');
      }
      const query: AgentAppIntentListQueryDto = limit === undefined ? {} : { limit };
      agentData(
        request,
        response,
        (
          await dependencies.host.listReceivedAppIntents(
            { userId: agentUserId(request), appId: pathParam(request.params.appId) },
            query.limit,
          )
        ).map(appIntentReceiptDto),
      );
    }),
  );

  router.get(
    '/apps/:appId/plugin-intents/:receiptId/artifacts/:artifactId',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        appIntentArtifactDto(
          await dependencies.host.getReceivedAppIntentArtifact(
            scope,
            pathParam(request.params.receiptId),
            pathParam(request.params.artifactId),
          ),
        ),
      );
    }),
  );

  router.get(
    '/apps/:appId/plugin-intents/:receiptId/artifacts/:artifactId/content',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const receiptId = pathParam(request.params.receiptId);
      const artifactId = pathParam(request.params.artifactId);
      const artifact = await dependencies.host.getReceivedAppIntentArtifact(scope, receiptId, artifactId);
      if (request.header('if-none-match') === `"${artifact.sha256}"`) {
        response.status(304).end();
        return;
      }
      response.setHeader('ETag', `"${artifact.sha256}"`);
      response.setHeader('Content-Type', artifact.mediaType);
      response.setHeader('Content-Disposition', appIntentContentDisposition(artifact.originalName));
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (artifact.sizeBytes === 0) {
        response.setHeader('Content-Length', '0');
        response.status(200).end();
        return;
      }

      const range = appIntentRangeFor(request.header('range'), artifact.sizeBytes);
      const readable = await dependencies.host.readReceivedAppIntentArtifact(scope, receiptId, artifactId, range);
      response.setHeader('Accept-Ranges', 'bytes');
      response.setHeader('Content-Length', String(range.endInclusive - range.start + 1));
      if (range.partial) {
        response.status(206);
        response.setHeader('Content-Range', `bytes ${range.start}-${range.endInclusive}/${artifact.sizeBytes}`);
      }
      for await (const chunk of readable.source) response.write(chunk);
      response.end();
    }),
  );

  router.delete(
    '/apps/:appId/plugin-intents/:receiptId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      await dependencies.host.revokeAppIntent(
        { userId: agentUserId(request), appId: pathParam(request.params.appId) },
        pathParam(request.params.receiptId),
      );
      const payload: AgentAppIntentRevokeResponseDto = { revoked: true };
      agentData(request, response, payload);
    }),
  );

  router.get('/events', (request, response) => {
    agentError(
      request,
      response,
      410,
      'AGENT_STREAM_PROTOCOL_REPLACED',
      'Agent event streaming moved to the /ws/agent WebSocket protocol.',
    );
  });

  router.get(
    '/summary',
    agentRoute(async (request, response) => {
      const userId = agentUserId(request);
      const [apps, settings, eventCursor] = await Promise.all([
        dependencies.host.listApps(userId),
        dependencies.host.getSettings(userId),
        dependencies.events.hostCursor(userId),
      ]);
      const availability = resolveAgentAvailability(settings, apps);
      agentData(request, response, hostSummaryDto(apps, availability, eventCursor));
    }),
  );

  router.patch(
    '/apps/:appId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      let input: AgentAppStateUpdateRequestDto;
      try {
        input = appStateUpdateRequest(request.body);
      } catch {
        agentError(request, response, 400, 'VALIDATION_FAILED', 'Invalid Agent App update.');
        return;
      }
      const app = await dependencies.host.setAppEnabled(
        agentUserId(request),
        pathParam(request.params.appId),
        input.enabled,
        input.expectedVersion,
      );
      agentData(request, response, appSummaryDto(app), app.observedState === 'disabling' ? 202 : 200);
    }),
  );

  router.get(
    '/target-denylist',
    agentRoute(async (request, response) => {
      const snapshot = await dependencies.host.getTargetDenylist();
      agentData(request, response, targetDenylistDto(snapshot));
    }),
  );

  router.put(
    '/target-denylist',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['connectionIds', 'reason', 'expectedRevision'])) {
        throw new Error('VALIDATION_FAILED');
      }
      if (
        !Array.isArray(request.body.connectionIds) ||
        request.body.connectionIds.length > 50 ||
        request.body.connectionIds.some((value) => !positiveInteger(value)) ||
        typeof request.body.reason !== 'string' ||
        request.body.reason.trim().length < 1 ||
        request.body.reason.trim().length > 512 ||
        !positiveInteger(request.body.expectedRevision)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const input: AgentTargetDenylistReplaceRequestDto = {
        connectionIds: [...new Set(request.body.connectionIds as number[])].sort((left, right) => left - right),
        reason: request.body.reason.trim(),
        expectedRevision: request.body.expectedRevision,
      };
      const updated = await dependencies.host.replaceTargetDenylist(
        agentUserId(request),
        input.connectionIds,
        input.reason,
        input.expectedRevision,
      );
      agentData(request, response, targetDenylistDto(updated));
    }),
  );

  router.get(
    '/onboarding/recommended-plugin',
    agentRoute(async (request, response) => {
      agentData(
        request,
        response,
        recommendedPluginDto(
          await dependencies.host.getRecommendedPlugin(agentUserId(request), AbortSignal.timeout(30_000)),
        ),
      );
    }),
  );

  router.post(
    '/onboarding/recommended-plugin/install',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        request.body !== undefined &&
        request.body !== null &&
        (!isRecord(request.body) || Object.keys(request.body).length > 0)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const input: AgentRecommendedPluginInstallRequestDto = {};
      void input;
      const installed = await dependencies.host.installRecommendedPlugin(
        agentUserId(request),
        AbortSignal.timeout(120_000),
      );
      agentData(request, response, recommendedPluginInstallResultDto(installed), 201);
    }),
  );

  router.get(
    '/settings',
    agentRoute(async (request, response) => {
      const userId = agentUserId(request);
      const [settings, apps] = await Promise.all([
        dependencies.host.getSettings(userId),
        dependencies.host.listApps(userId),
      ]);
      agentData(request, response, settingsViewDto(settings, resolveAgentAvailability(settings, apps)));
    }),
  );

  router.patch(
    '/settings',
    mutationSecurity,
    agentRoute(async (request, response) => {
      let input: AgentSettingsPatchRequestDto;
      try {
        input = settingsPatchRequest(request.body);
      } catch {
        agentError(request, response, 400, 'VALIDATION_FAILED', 'Invalid Agent settings update.');
        return;
      }
      const userId = agentUserId(request);
      const settings = await dependencies.host.patchSettings(userId, input.patch, input.expectedVersion);
      const apps = await dependencies.host.listApps(userId);
      agentData(request, response, settingsViewDto(settings, resolveAgentAvailability(settings, apps)));
    }),
  );

  router.post(
    '/settings/hard-limits/preview',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = hardLimitPreviewRequest(request.body);
      const preview = await dependencies.host.previewHardLimits(
        agentUserId(request),
        input.proposed,
        input.expectedVersion,
      );
      agentData(request, response, hardLimitPreviewDto(preview));
    }),
  );

  router.post(
    '/settings/hard-limits/confirm',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = hardLimitConfirmRequest(request.body);
      const userId = agentUserId(request);
      const settings = await dependencies.host.confirmHardLimits(userId, input.confirmationId, input.expectedVersion);
      const apps = await dependencies.host.listApps(userId);
      agentData(request, response, settingsViewDto(settings, resolveAgentAvailability(settings, apps)));
    }),
  );

  router.get(
    '/ai/models',
    agentRoute(async (request, response) => {
      const providers = await dependencies.providers.list(agentUserId(request));
      const payload: AgentAvailableModelDto[] = providers
        .filter((provider) => provider.enabled)
        .flatMap((provider) =>
          provider.models.map((model) => ({
            providerId: provider.id,
            providerDisplayName: provider.displayName,
            configurationVersion: provider.version,
            modelId: model.id,
            contextWindow: model.contextWindow,
            maxOutputTokens: model.maxOutputTokens,
            supportsTools: model.supportsTools,
            reasoning: {
              supportedEfforts: model.reasoningEfforts ?? [],
              defaultEffort: model.defaultReasoningEffort ?? null,
              source: model.reasoningSource ?? null,
              mandatory: model.reasoningMandatory ?? false,
            },
          })),
        );
      agentData(request, response, payload);
    }),
  );

  router.get(
    '/ai/model-registry/resolve',
    agentRoute(async (request, response) => {
      agentUserId(request);
      const modelId = queryString(request.query.modelId);
      if (!modelId || modelId.length > 256) throw new Error('VALIDATION_FAILED');
      const query: AgentModelRegistryResolveQueryDto = { modelId };
      const payload: AgentModelRegistryResolveResponseDto = {
        modelId: query.modelId,
        defaults: dependencies.modelRegistry.resolve(query.modelId),
      };
      agentData(request, response, payload);
    }),
  );

  router.get(
    '/ai/model-registry',
    agentRoute(async (request, response) => {
      agentUserId(request);
      agentData(request, response, modelRegistryStatusDto(dependencies.modelRegistry.status()));
    }),
  );

  router.post(
    '/ai/model-registry/refresh',
    mutationSecurity,
    agentRoute(async (request, response) => {
      agentUserId(request);
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, [])) throw new Error('VALIDATION_FAILED');
      agentData(request, response, modelRegistryStatusDto(await dependencies.modelRegistry.refresh()));
    }),
  );

  router.patch(
    '/ai/model-registry',
    mutationSecurity,
    agentRoute(async (request, response) => {
      agentUserId(request);
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['autoUpdate']) ||
        typeof request.body.autoUpdate !== 'boolean'
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const input: AgentModelRegistryUpdateRequestDto = { autoUpdate: request.body.autoUpdate };
      agentData(
        request,
        response,
        modelRegistryStatusDto(await dependencies.modelRegistry.setAutoUpdate(input.autoUpdate)),
      );
    }),
  );

  router.get(
    '/ai/providers',
    agentRoute(async (request, response) => {
      const payload: AgentProviderViewDto[] = (await dependencies.providers.list(agentUserId(request))).map(
        providerDto,
      );
      agentData(request, response, payload);
    }),
  );

  router.post(
    '/ai/providers',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = providerCreateInput(request.body);
      const provider = await dependencies.providers.create(agentUserId(request), input);
      agentData(request, response, providerDto(provider), 201);
    }),
  );

  router.post(
    '/ai/providers/discover-endpoint-models',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['baseUrl', 'credential']) ||
        !nonEmptyString(request.body.baseUrl) ||
        (request.body.credential !== undefined && typeof request.body.credential !== 'string')
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const input: AgentDiscoverEndpointModelsRequestDto = {
        baseUrl: request.body.baseUrl,
        ...(typeof request.body.credential === 'string' && request.body.credential.trim()
          ? { credential: request.body.credential.trim() }
          : {}),
      };
      const payload: AgentDiscoveredProviderModelDto[] = (
        await dependencies.providers.discoverEndpointModels(input.baseUrl, input.credential)
      ).map(discoveredProviderModelDto);
      agentData(request, response, payload);
    }),
  );

  router.patch(
    '/ai/providers/:providerId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const currentUserId = agentUserId(request);
      const providerId = pathParam(request.params.providerId);
      const { expectedVersion, input } = await providerPatchInput(
        dependencies.providers,
        currentUserId,
        providerId,
        request.body,
      );
      agentData(
        request,
        response,
        providerDto(await dependencies.providers.update(currentUserId, providerId, expectedVersion, input)),
      );
    }),
  );

  router.delete(
    '/ai/providers/:providerId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const rawVersion = Array.isArray(request.query.expectedVersion)
        ? request.query.expectedVersion[0]
        : request.query.expectedVersion;
      const expectedVersion = typeof rawVersion === 'string' ? Number(rawVersion) : Number.NaN;
      if (!positiveInteger(expectedVersion)) throw new Error('VALIDATION_FAILED');
      const query: AgentProviderDeleteQueryDto = { expectedVersion };
      await dependencies.providers.remove(
        agentUserId(request),
        pathParam(request.params.providerId),
        query.expectedVersion,
      );
      const payload: AgentProviderDeleteResponseDto = { deleted: true };
      agentData(request, response, payload);
    }),
  );

  router.post(
    '/ai/providers/:providerId/discover-models',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, [])) throw new Error('VALIDATION_FAILED');
      const payload: AgentDiscoveredProviderModelDto[] = (
        await dependencies.providers.discoverModels(agentUserId(request), pathParam(request.params.providerId))
      ).map(discoveredProviderModelDto);
      agentData(request, response, payload);
    }),
  );

  router.post(
    '/ai/providers/:providerId/test',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['modelId']) || !nonEmptyString(request.body.modelId)) {
        throw new Error('VALIDATION_FAILED');
      }
      const input: AgentProviderTestRequestDto = { modelId: request.body.modelId };
      agentData(
        request,
        response,
        providerTestDto(
          await dependencies.providers.test(agentUserId(request), pathParam(request.params.providerId), input.modelId),
        ),
      );
    }),
  );

  router.get(
    '/files',
    agentRoute(async (request, response) => {
      const rawLimit = queryString(request.query.limit);
      const limit = rawLimit === undefined ? 50 : Number(rawLimit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('VALIDATION_FAILED');
      const retainedRaw = queryString(request.query.retained);
      if (retainedRaw !== undefined && retainedRaw !== 'true' && retainedRaw !== 'false') {
        throw new Error('VALIDATION_FAILED');
      }
      const kind = artifactFileKind(queryString(request.query.kind));
      const before = queryString(request.query.before);
      const q = queryString(request.query.q);
      const appId = queryString(request.query.appId);
      const query: AgentArtifactLibraryQueryDto = {
        limit,
        ...(before === undefined ? {} : { before }),
        ...(q === undefined ? {} : { q }),
        ...(appId === undefined ? {} : { appId }),
        ...(retainedRaw === undefined ? {} : { retained: retainedRaw === 'true' }),
        ...(kind === undefined ? {} : { kind }),
      };
      const page = await dependencies.artifacts.listLibrary(agentUserId(request), query);
      agentData(request, response, artifactPageDto(page));
    }),
  );

  router.get(
    '/files/storage',
    agentRoute(async (request, response) => {
      agentData(
        request,
        response,
        artifactStorageSummaryDto(await dependencies.artifacts.storageSummary(agentUserId(request))),
      );
    }),
  );

  router.post(
    '/files/cleanup/preview',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        request.body !== undefined &&
        request.body !== null &&
        (!isRecord(request.body) || Object.keys(request.body).length > 0)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(
        request,
        response,
        artifactCleanupPreviewDto(await dependencies.artifacts.cleanupPreview(agentUserId(request))),
      );
    }),
  );

  router.post(
    '/files/cleanup/confirm',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['confirmationId']) ||
        !nonEmptyString(request.body.confirmationId)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const input: AgentArtifactCleanupConfirmRequestDto = { confirmationId: request.body.confirmationId };
      agentData(
        request,
        response,
        artifactCleanupResultDto(
          await dependencies.artifacts.cleanupConfirm(agentUserId(request), input.confirmationId),
        ),
      );
    }),
  );

  router.post(
    '/files/:artifactId/attach',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['targetAppId', 'threadId', 'runId', 'role', 'expectedVersion']) ||
        !nonEmptyString(request.body.targetAppId) ||
        !nonEmptyString(request.body.threadId) ||
        (request.body.runId !== undefined && !nonEmptyString(request.body.runId)) ||
        request.body.role !== 'input' ||
        (request.body.expectedVersion !== undefined && !positiveInteger(request.body.expectedVersion))
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const input: AgentArtifactAttachRequestDto = {
        targetAppId: request.body.targetAppId,
        threadId: request.body.threadId,
        ...(request.body.runId === undefined ? {} : { runId: request.body.runId }),
        role: 'input',
        ...(request.body.expectedVersion === undefined ? {} : { expectedVersion: request.body.expectedVersion }),
      };
      agentData(
        request,
        response,
        artifactAttachResponseDto(
          await dependencies.artifacts.attach(agentUserId(request), pathParam(request.params.artifactId), input),
        ),
      );
    }),
  );

  router.use('/workspace-runtime', createWorkspaceRuntimeRouter(dependencies.workspaceRuntime, mutationSecurity));

  return router;
};
