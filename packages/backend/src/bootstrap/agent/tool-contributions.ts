import type { AgentSettingsService } from '../../modules/agent/host/agent-settings.service';
import type { ArtifactService } from '../../modules/agent/ai/artifact.service';
import type { IntegrationRepositoryPort } from '../../modules/agent/ai/integration.repository.port';
import type { IntegrationServiceHooks } from '../../modules/agent/ai/integration.service';
import type { AcpRuntimePort, BrowserGatewayPort, McpRuntimePort } from '../../modules/agent/ai/integrations.types';
import type { MemoryService } from '../../modules/agent/ai/memory.service';
import { createCollaborationTools } from '../../modules/agent/apps/operations/collaboration-tools';
import { createMcpTools } from '../../modules/agent/apps/operations/mcp-tools';
import { createAcpExecuteTool } from '../../modules/agent/apps/operations/acp-tools';
import { createBrowserTools } from '../../modules/agent/apps/operations/browser-tools';
import {
  createDockerMutationTool,
  createShellTool,
  createWriteFileTool,
} from '../../modules/agent/apps/operations/mutation-tools';
import { createDiagnosticsTool, createReadFileTool } from '../../modules/agent/apps/operations/tools';
import {
  createWorkspaceControlTool,
  createWorkspaceCreateTool,
  createWorkspaceSwitchToolVersionsTool,
} from '../../modules/agent/apps/operations/workspace-runtime-management-tools';
import { createWorkspaceJobTool } from '../../modules/agent/apps/operations/workspace-tools';
import type { CryptoHashPort } from '../../modules/agent/crypto-hash.port';
import type { MachineCapabilityPort } from '../../modules/agent/capabilities/machine.port';
import type { ToolCatalog } from '../../modules/agent/capabilities/tool-catalog';
import type { MailboxService } from '../../modules/agent/runtime/collaboration/mailbox.service';
import type { SharedFactsService } from '../../modules/agent/runtime/collaboration/shared-facts.service';
import type { SubagentService } from '../../modules/agent/runtime/collaboration/subagent.service';
import { createPlanUpdateTool } from '../../modules/agent/runtime/planning/plan-tool';
import type { PlanService } from '../../modules/agent/runtime/planning/plan.service';
import type { RunSnapshotReaderPort } from '../../modules/agent/runtime/runs/run.repository.port';
import type { WorkspaceRuntimeGatewayPort } from '../../modules/agent/workspace-runtime/workspace-runtime-gateway.port';
import type { AgentWorkspaceRepositoryPort } from '../../modules/agent/workspace-runtime/workspace-runtime.repository.port';
import type { WorkspaceRuntimeService } from '../../modules/agent/workspace-runtime/workspace-runtime.service';

export interface MachineToolContributionOptions {
  catalog: ToolCatalog;
  machine: MachineCapabilityPort;
  artifacts: ArtifactService;
  cryptoHash: CryptoHashPort;
}

export const registerMachineToolContributions = ({
  catalog,
  machine,
  artifacts,
  cryptoHash,
}: MachineToolContributionOptions): void => {
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.diagnostics',
    capability: 'machine.diagnostics.read',
    tools: [createDiagnosticsTool(machine, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.files.read',
    capability: 'machine.files.read',
    tools: [createReadFileTool(machine, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.files.write',
    capability: 'machine.files.write',
    tools: [createWriteFileTool(machine, artifacts, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.shell',
    capability: 'machine.shell.execute',
    tools: [createShellTool(machine, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.docker',
    capability: 'machine.docker.mutate',
    tools: [createDockerMutationTool(machine, cryptoHash)],
  });
};

export interface WorkspaceToolContributionOptions {
  catalog: ToolCatalog;
  repository: AgentWorkspaceRepositoryPort;
  runtime: WorkspaceRuntimeService;
  gateway: WorkspaceRuntimeGatewayPort;
  cryptoHash: CryptoHashPort;
}

export const registerWorkspaceToolContributions = ({
  catalog,
  repository,
  runtime,
  gateway,
  cryptoHash,
}: WorkspaceToolContributionOptions): void => {
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'workspace.runtime.execute',
    capability: 'workspace.runtime.execute',
    tools: [createWorkspaceJobTool(repository, gateway, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'workspace.runtime.manage',
    capability: 'workspace.runtime.manage',
    tools: [
      createWorkspaceCreateTool(runtime, repository, cryptoHash),
      createWorkspaceControlTool(runtime, repository, cryptoHash),
      createWorkspaceSwitchToolVersionsTool(runtime, repository, cryptoHash),
    ],
  });
};

export interface RuntimeToolContributionOptions {
  catalog: ToolCatalog;
  plans: PlanService;
  runs: RunSnapshotReaderPort;
  subagents: SubagentService;
  mailbox: MailboxService;
  facts: SharedFactsService;
  memories: MemoryService;
  cryptoHash: CryptoHashPort;
}

export const registerRuntimeToolContributions = ({
  catalog,
  plans,
  runs,
  subagents,
  mailbox,
  facts,
  memories,
  cryptoHash,
}: RuntimeToolContributionOptions): void => {
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'runtime.plan',
    capability: 'runs.execute',
    tools: [createPlanUpdateTool(plans, runs, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'runtime.collaboration',
    capability: 'runs.execute',
    tools: createCollaborationTools(subagents, mailbox, facts, memories, cryptoHash),
  });
};

export interface AcpToolContributionOptions {
  catalog: ToolCatalog;
  repository: IntegrationRepositoryPort;
  workspaces: AgentWorkspaceRepositoryPort;
  runtime: AcpRuntimePort;
  cryptoHash: CryptoHashPort;
}

export const registerAcpToolContribution = ({
  catalog,
  repository,
  workspaces,
  runtime,
  cryptoHash,
}: AcpToolContributionOptions): void => {
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'integration.acp.execute',
    capability: 'integration.acp.execute',
    tools: [createAcpExecuteTool(repository, workspaces, runtime, cryptoHash)],
  });
};

export interface BrowserToolContributionOptions {
  catalog: ToolCatalog;
  workspaces: AgentWorkspaceRepositoryPort;
  settings: AgentSettingsService;
  gateway: BrowserGatewayPort;
  cryptoHash: CryptoHashPort;
}

export const registerBrowserToolContribution = ({
  catalog,
  workspaces,
  settings,
  gateway,
  cryptoHash,
}: BrowserToolContributionOptions): void => {
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'browser.operate',
    capability: 'browser.operate',
    tools: createBrowserTools(workspaces, settings, gateway, cryptoHash),
  });
};

export interface McpToolContributionOptions {
  catalog: ToolCatalog;
  repository: IntegrationRepositoryPort;
  runtime: McpRuntimePort;
  cryptoHash: CryptoHashPort;
}

export const createMcpToolContributionHooks = ({
  catalog,
  repository,
  runtime,
  cryptoHash,
}: McpToolContributionOptions): IntegrationServiceHooks => ({
  mcpRefreshed: (scope, integration, snapshot, schemaHash) => {
    catalog.replaceOwnedContribution(scope, `mcp:${integration.id}`, {
      schemaVersion: 1,
      id: `integration.mcp.${integration.id}`,
      capability: 'integration.mcp.invoke',
      tools: createMcpTools(scope, integration, schemaHash, snapshot.tools, repository, runtime, cryptoHash),
    });
  },
  removed: (scope, integrationId) => catalog.removeOwned(scope, `mcp:${integrationId}`),
});
