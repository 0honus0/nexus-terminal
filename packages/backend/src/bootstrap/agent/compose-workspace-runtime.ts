import { SqliteWorkspaceRepository } from '../../infrastructure/agent/workspace-runtime/sqlite-workspace.repository';
import { SqliteWorkspaceRuntimeConfirmationRepository } from '../../infrastructure/agent/workspace-runtime/sqlite-workspace-runtime-confirmation.repository';
import type { RelationalDatabase } from '../../platform/storage/relational-database.port';
import type { ArtifactService } from '../../modules/agent/ai/artifact.service';
import type { CryptoHashPort } from '../../modules/agent/crypto-hash.port';
import type { AppCapabilityBroker } from '../../modules/agent/host/app-capability-broker';
import type { AppLifecycleService } from '../../modules/agent/host/app-lifecycle.service';
import type { AgentSettingsService } from '../../modules/agent/host/agent-settings.service';
import type { PluginRunnerTargetSourcePort } from '../../modules/agent/host/plugin-runner-target.port';
import type { AgentWorkspaceRuntimeFacade } from '../../modules/agent/public';
import { WorkspaceArtifactService } from '../../modules/agent/exchange/workspace-artifact.service';
import type { WorkspaceRuntimeControllerPort } from '../../modules/agent/workspace-runtime/workspace-runtime-controller.port';
import type { WorkspaceRuntimeGatewayPort } from '../../modules/agent/workspace-runtime/workspace-runtime-gateway.port';
import { WorkspaceRuntimeManagementService } from '../../modules/agent/workspace-runtime/workspace-runtime-management.service';
import { WorkspaceRuntimeService } from '../../modules/agent/workspace-runtime/workspace-runtime.service';

export interface ComposeWorkspaceRuntimeOptions {
  database: RelationalDatabase;
  controller: WorkspaceRuntimeControllerPort & WorkspaceRuntimeGatewayPort;
  pluginTargets: PluginRunnerTargetSourcePort;
  settings: AgentSettingsService;
  lifecycle: AppLifecycleService;
  capabilities: AppCapabilityBroker;
  cryptoHash: CryptoHashPort;
  artifacts: ArtifactService;
  now: () => number;
}

export interface ComposedWorkspaceRuntime {
  repository: SqliteWorkspaceRepository;
  service: WorkspaceRuntimeService;
  facade: AgentWorkspaceRuntimeFacade;
}

/**
 * Owns Workspace Runtime composition so the Agent root does not know about
 * confirmation persistence, artifact exchange plumbing, or facade delegation.
 * Plugin integration crosses this boundary only through PluginRunnerTargetSourcePort.
 */
export const composeWorkspaceRuntime = ({
  database,
  controller,
  pluginTargets,
  settings,
  lifecycle,
  capabilities,
  cryptoHash,
  artifacts,
  now,
}: ComposeWorkspaceRuntimeOptions): ComposedWorkspaceRuntime => {
  const repository = new SqliteWorkspaceRepository(database);
  const confirmations = new SqliteWorkspaceRuntimeConfirmationRepository(database);
  const service = new WorkspaceRuntimeService(
    controller,
    repository,
    pluginTargets,
    settings,
    lifecycle,
    capabilities,
    cryptoHash,
    now,
  );
  const management = new WorkspaceRuntimeManagementService(
    controller,
    repository,
    confirmations,
    settings,
    service,
    now,
  );
  const workspaceArtifacts = new WorkspaceArtifactService(service, artifacts, capabilities);

  const facade: AgentWorkspaceRuntimeFacade = {
    availability: (signal) => service.availability(signal),
    catalog: (signal) => service.catalog(signal),
    storage: (signal) => service.storage(signal),
    listWorkspaces: (scope, runId) => service.listWorkspaces(scope, runId),
    getWorkspace: (scope, workspaceId) => service.getWorkspace(scope, workspaceId),
    workspaceGrants: (scope, workspaceId, targetPluginId) =>
      service.workspaceGrants(scope, workspaceId, targetPluginId),
    replaceWorkspaceGrants: (scope, workspaceId, targetPluginId, grants) =>
      service.replaceWorkspaceGrants(scope, workspaceId, targetPluginId, grants),
    exportWorkspaceArtifact: (scope, input, signal) => workspaceArtifacts.export(scope, input, signal),
    importArtifactToWorkspace: (scope, input, signal) => workspaceArtifacts.import(scope, input, signal),
    createWorkspace: (scope, runId, agentRuntimeId, workspace, retained, idempotencyKey, catalogRevision) =>
      service.createWorkspace(scope, runId, agentRuntimeId, workspace, retained, idempotencyKey, catalogRevision),
    action: (scope, workspaceId, action, expectedVersion, parameters) =>
      service.action(scope, workspaceId, action, expectedVersion, parameters),
    switchToolVersions: (scope, workspaceId, versions, expectedVersion, expectedCatalogRevision) =>
      service.switchToolVersions(scope, workspaceId, versions, expectedVersion, expectedCatalogRevision),
    getCommand: (scope, commandId) => service.getCommand(scope, commandId),
    previewSetup: (userId, selections, expectedVersion) => management.previewSetup(userId, selections, expectedVersion),
    confirmSetup: (userId, confirmationId, expectedVersion) =>
      management.confirmSetup(userId, confirmationId, expectedVersion),
    installPack: (userId, familyId, versionId) => management.installPack(userId, familyId, versionId),
    previewPackUninstall: (userId, familyId, versionId, expectedVersion) =>
      management.previewPackUninstall(userId, familyId, versionId, expectedVersion),
    confirmPackUninstall: (userId, confirmationId, expectedVersion) =>
      management.confirmPackUninstall(userId, confirmationId, expectedVersion),
    previewRuntimeCleanup: (userId, expectedVersion) => management.previewRuntimeCleanup(userId, expectedVersion),
    confirmRuntimeCleanup: (userId, confirmationId, expectedVersion) =>
      management.confirmRuntimeCleanup(userId, confirmationId, expectedVersion),
    previewSettingsReset: (userId, expectedVersion) => management.previewSettingsReset(userId, expectedVersion),
    confirmSettingsReset: (userId, confirmationId, expectedVersion) =>
      management.confirmSettingsReset(userId, confirmationId, expectedVersion),
    adminAction: (userId, action, payload) => service.adminAction(userId, action, payload),
  };

  return { repository, service, facade };
};
