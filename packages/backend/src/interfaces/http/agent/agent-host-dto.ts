import type {
  AgentAppGrantViewDto,
  AgentAppSummaryDto,
  AgentAvailabilityViewDto,
  AgentCapabilityDefinitionDto,
  AgentCapabilityGrantDto,
  AgentExecutionPolicyViewDto,
  AgentHardLimitPreviewDto,
  AgentHostSummaryDto,
  AgentSettingsViewDto,
} from '@nexus-terminal/protocol/agent-host';
import type {
  AgentHostFacade,
  AppView,
} from '../../../modules/agent/public';

type SettingsView = Awaited<ReturnType<AgentHostFacade['getSettings']>>;
type HardLimitPreview = Awaited<ReturnType<AgentHostFacade['previewHardLimits']>>;
type ExecutionPolicyView = Awaited<ReturnType<AgentHostFacade['getAppExecutionPolicy']>>;
type CapabilityDefinition = ReturnType<AgentHostFacade['listCapabilityDefinitions']>[number];
type CapabilityGrant = Awaited<ReturnType<AgentHostFacade['listAppGrants']>>[number];

export const appSummaryDto = (app: AppView): AgentAppSummaryDto => ({
  id: app.appId,
  displayName: app.displayName,
  version: app.activeVersion,
  surface: app.surface,
  defaultApprovalMode: app.defaultApprovalMode,
  stateVersion: app.version,
  enabled: app.desiredState === 'enabled',
  health:
    app.observedState === 'running'
      ? 'healthy'
      : app.observedState === 'degraded'
        ? 'degraded'
        : app.observedState === 'disabled'
          ? 'disabled'
          : app.observedState === 'failed'
            ? 'failed'
            : app.observedState,
  healthReason: app.healthReason,
  runningRuns: app.runningCount,
  pendingApprovals: app.approvalCount,
  pendingBudgetRequests: app.budgetRequestCount,
});

export const settingsViewDto = (
  settings: SettingsView,
  availability: AgentAvailabilityViewDto,
): AgentSettingsViewDto => ({
  requestedSettings: settings.requestedSettings,
  effectiveSettings: settings.effectiveSettings,
  hardLimits: settings.hardLimits,
  runtimeCapabilities: { workspaceRuntimeController: false },
  availability,
  revision: settings.revision,
});

export const hardLimitPreviewDto = (preview: HardLimitPreview): AgentHardLimitPreviewDto => ({
  confirmationId: preview.confirmationId,
  expectedVersion: preview.expectedVersion,
  current: preview.current,
  proposed: preview.proposed,
  impact: {
    changes: preview.impact.changes.map((change) => ({ ...change })),
    hasIncrease: preview.impact.hasIncrease,
    hasDecrease: preview.impact.hasDecrease,
    usage: { ...preview.impact.usage },
  },
  expiresAt: preview.expiresAt,
  runtimeCapabilities: { workspaceRuntimeController: false },
});

export const capabilityDefinitionDto = (definition: CapabilityDefinition): AgentCapabilityDefinitionDto => ({
  id: definition.id,
  scopeKind: definition.scopeKind,
  supportedTargets: [...definition.supportedTargets],
  defaultScope: definition.defaultScope,
});

export const capabilityGrantDto = (grant: CapabilityGrant): AgentCapabilityGrantDto => ({
  capability: grant.capability,
  schemaVersion: 2,
  scope: grant.scope,
  grantedAt: grant.grantedAt,
});

export const appGrantViewDto = (
  app: AppView,
  definitions: readonly CapabilityDefinition[],
  grants: readonly CapabilityGrant[],
): AgentAppGrantViewDto => ({
  app: appSummaryDto(app),
  policyRevision: app.policyRevision,
  capabilityDefinitions: definitions.map(capabilityDefinitionDto),
  grants: grants.map(capabilityGrantDto),
});

export const executionPolicyDto = (view: ExecutionPolicyView): AgentExecutionPolicyViewDto => ({
  overrides: { ...view.overrides },
  effective: { ...view.effective },
  version: view.version,
});

export const hostSummaryDto = (
  apps: readonly AppView[],
  availability: AgentAvailabilityViewDto,
  eventCursor: number,
): AgentHostSummaryDto => {
  const summaries = apps.map(appSummaryDto);
  const totalRunningRuns = summaries.reduce((total, app) => total + app.runningRuns, 0);
  const totalPendingApprovals = summaries.reduce((total, app) => total + app.pendingApprovals, 0);
  const totalPendingBudgetRequests = summaries.reduce((total, app) => total + app.pendingBudgetRequests, 0);
  return {
    featureEnabled: availability.state === 'enabled' || availability.state === 'degraded',
    hostState:
      availability.state === 'disabled' && totalRunningRuns > 0
        ? 'disabling'
        : availability.state === 'unavailable'
          ? 'disabled'
          : availability.state,
    apps: summaries,
    totalRunningRuns,
    totalPendingApprovals,
    totalPendingBudgetRequests,
    eventCursor,
  };
};
