import { SqliteWorkspaceRepository } from '../../infrastructure/agent/workspace-runtime/sqlite-workspace.repository';
import type { RelationalDatabase } from '../../platform/storage/relational-database.port';
import type { BrowserGatewayPort } from '../../modules/agent/ai/integrations.types';
import type { CryptoHashPort } from '../../modules/agent/crypto-hash.port';
import type { AppCapabilityBroker } from '../../modules/agent/host/app-capability-broker';
import type { AppLifecycleService } from '../../modules/agent/host/app-lifecycle.service';
import type { AgentSettingsService } from '../../modules/agent/host/agent-settings.service';
import type { WorkspaceRuntimeControllerPort } from '../../modules/agent/workspace-runtime/workspace-runtime-controller.port';
import type { WorkspaceRuntimeGatewayPort } from '../../modules/agent/workspace-runtime/workspace-runtime-gateway.port';
import { WorkspaceRuntimeService } from '../../modules/agent/workspace-runtime/workspace-runtime.service';

export interface ComposeWorkspaceRuntimeOptions {
  database: RelationalDatabase;
  controller: WorkspaceRuntimeControllerPort & WorkspaceRuntimeGatewayPort;
  settings: AgentSettingsService;
  lifecycle: AppLifecycleService;
  capabilities: AppCapabilityBroker;
  cryptoHash: CryptoHashPort;
  browserGateway: BrowserGatewayPort;
  now: () => number;
}

export interface ComposedWorkspaceRuntime {
  repository: SqliteWorkspaceRepository;
  service: WorkspaceRuntimeService;
}

/**
 * Owns Workspace Runtime composition so the Agent root does not know about
 * confirmation persistence, artifact exchange plumbing, or facade delegation.
 */
export const composeWorkspaceRuntime = ({
  database,
  controller,
  settings,
  lifecycle,
  capabilities,
  cryptoHash,
  browserGateway,
  now,
}: ComposeWorkspaceRuntimeOptions): ComposedWorkspaceRuntime => {
  const repository = new SqliteWorkspaceRepository(database);
  const service = new WorkspaceRuntimeService(
    controller,
    repository,
    settings,
    lifecycle,
    capabilities,
    cryptoHash,
    now,
  );

  return { repository, service };
};
