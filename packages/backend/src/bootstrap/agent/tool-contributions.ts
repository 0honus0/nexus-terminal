import type { AgentSettingsService } from '../../modules/agent/host/agent-settings.service';
import type { ArtifactService } from '../../modules/agent/ai/artifact.service';
import type { IntegrationRepositoryPort } from '../../modules/agent/ai/integration.repository.port';
import type { IntegrationServiceHooks } from '../../modules/agent/ai/integration.service';
import type { AcpRuntimePort, BrowserGatewayPort, McpRuntimePort } from '../../modules/agent/ai/integrations.types';
import type { MemoryService } from '../../modules/agent/ai/memory.service';
import type { SkillRegistry } from '../../modules/agent/ai/skill-registry';
import { createCollaborationTools } from '../../modules/agent/tools/host/collaboration-tools';
import { createMcpTools } from '../../modules/agent/tools/host/mcp-tools';
import { createAcpExecuteTool } from '../../modules/agent/tools/host/acp-tools';
import { createBrowserTools } from '../../modules/agent/tools/host/browser-tools';
import {
  createDockerMutationTool,
  createShellTool,
  createWriteFileTool,
} from '../../modules/agent/tools/host/mutation-tools';
import {
  createConnectionListTool,
  createDiagnosticsTool,
  createReadFileTool,
} from '../../modules/agent/tools/host/tools';
import {
  createWorkspaceControlTool,
  createWorkspaceCreateTool,
  createWorkspaceSwitchToolVersionsTool,
} from '../../modules/agent/tools/host/workspace-runtime-management-tools';
import { createWorkspaceJobControlTool, createWorkspaceJobTool } from '../../modules/agent/tools/host/workspace-tools';
import {
  createWorkspaceApplyPatchTool,
  createWorkspaceCodeIntelTool,
  createWorkspaceReadFileTool,
  createWorkspaceRepoMapTool,
  createWorkspaceSearchTool,
} from '../../modules/agent/tools/host/workspace-coding-tools';
import { createSkillReadTool, createSkillSearchTool } from '../../modules/agent/tools/host/skill-tools';
import { createRequestUserInputTool } from '../../modules/agent/tools/host/user-input-tools';
import { createToolSearchTool } from '../../modules/agent/tools/host/tool-discovery-tools';
import { createArtifactReadTool } from '../../modules/agent/tools/host/artifact-tools';
import type { CryptoHashPort } from '../../modules/agent/crypto-hash.port';
import type { MachineCapabilityPort } from '../../modules/agent/capabilities/machine.port';
import type { AgentTargetResolver } from '../../modules/agent/capabilities/target-resolver';
import type { ToolCatalog } from '../../modules/agent/capabilities/tool-catalog';
import type { MailboxService } from '../../modules/agent/runtime/collaboration/mailbox.service';
import type { SharedFactsService } from '../../modules/agent/runtime/collaboration/shared-facts.service';
import type { AcpPermissionRequestPort } from '../../modules/agent/runtime/approvals/acp-permission-broker';
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
    id: 'machine.inspect',
    tools: [createConnectionListTool(machine, cryptoHash), createDiagnosticsTool(machine, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.files.read',
    tools: [createReadFileTool(machine, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.files.write',
    tools: [createWriteFileTool(machine, artifacts, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.shell',
    tools: [createShellTool(machine, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.docker',
    tools: [createDockerMutationTool(machine, cryptoHash)],
  });
};

export interface WorkspaceToolContributionOptions {
  catalog: ToolCatalog;
  repository: AgentWorkspaceRepositoryPort;
  targets: AgentTargetResolver;
  runtime: WorkspaceRuntimeService;
  gateway: WorkspaceRuntimeGatewayPort;
  artifacts: ArtifactService;
  cryptoHash: CryptoHashPort;
}

export const registerWorkspaceToolContributions = ({
  catalog,
  repository,
  targets,
  runtime,
  gateway,
  artifacts,
  cryptoHash,
}: WorkspaceToolContributionOptions): void => {
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'workspace.tools',
    tools: [
      createWorkspaceReadFileTool(targets, runtime, cryptoHash),
      createWorkspaceSearchTool(targets, runtime, cryptoHash),
      createWorkspaceRepoMapTool(targets, runtime, cryptoHash),
      createWorkspaceCodeIntelTool(targets, runtime, cryptoHash),
      createWorkspaceApplyPatchTool(targets, runtime, cryptoHash, artifacts),
      createWorkspaceJobTool(repository, gateway, cryptoHash),
      createWorkspaceJobControlTool(repository, gateway, cryptoHash),
    ],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'workspace.runtime',
    tools: [
      createWorkspaceCreateTool(runtime, repository, cryptoHash),
      createWorkspaceControlTool(runtime, repository, cryptoHash),
      createWorkspaceSwitchToolVersionsTool(runtime, repository, cryptoHash),
    ],
  });
};

export interface RuntimeToolContributionOptions {
  catalog: ToolCatalog;
  artifacts: ArtifactService;
  plans: PlanService;
  runs: RunSnapshotReaderPort;
  subagents: SubagentService;
  mailbox: MailboxService;
  facts: SharedFactsService;
  memories: MemoryService;
  skills: SkillRegistry;
  cryptoHash: CryptoHashPort;
}

export const registerRuntimeToolContributions = ({
  catalog,
  artifacts,
  plans,
  runs,
  subagents,
  mailbox,
  facts,
  memories,
  skills,
  cryptoHash,
}: RuntimeToolContributionOptions): void => {
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'runtime.artifacts.read',
    tools: [createArtifactReadTool(artifacts, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'integration.mcp.discovery',
    tools: [createToolSearchTool(catalog, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'runtime.skills',
    tools: [createSkillSearchTool(skills, cryptoHash), createSkillReadTool(skills, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'runtime.plan',
    tools: [createPlanUpdateTool(plans, runs, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'runtime.user-input',
    tools: [createRequestUserInputTool(cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'runtime.collaboration',
    tools: createCollaborationTools(subagents, mailbox, facts, memories, cryptoHash),
  });
};

export interface AcpToolContributionOptions {
  catalog: ToolCatalog;
  repository: IntegrationRepositoryPort;
  workspaces: AgentWorkspaceRepositoryPort;
  runtime: AcpRuntimePort;
  cryptoHash: CryptoHashPort;
  permissionRequests: AcpPermissionRequestPort;
}

export const registerAcpToolContribution = ({
  catalog,
  repository,
  workspaces,
  runtime,
  cryptoHash,
  permissionRequests,
}: AcpToolContributionOptions): void => {
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'integration.acp.invoke',
    tools: [createAcpExecuteTool(repository, workspaces, runtime, cryptoHash, permissionRequests)],
  });
};

export interface BrowserToolContributionOptions {
  catalog: ToolCatalog;
  workspaces: AgentWorkspaceRepositoryPort;
  settings: AgentSettingsService;
  gateway: BrowserGatewayPort;
  cryptoHash: CryptoHashPort;
  artifacts: ArtifactService;
}

export const registerBrowserToolContribution = ({
  catalog,
  workspaces,
  settings,
  gateway,
  cryptoHash,
  artifacts,
}: BrowserToolContributionOptions): void => {
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'browser.tools',
    tools: createBrowserTools(workspaces, settings, gateway, cryptoHash, artifacts),
  });
};

export interface McpToolContributionOptions {
  catalog: ToolCatalog;
  repository: IntegrationRepositoryPort;
  runtime: McpRuntimePort;
  artifacts: ArtifactService;
  cryptoHash: CryptoHashPort;
}

export const createMcpToolContributionHooks = ({
  catalog,
  repository,
  runtime,
  artifacts,
  cryptoHash,
}: McpToolContributionOptions): IntegrationServiceHooks => ({
  mcpRefreshed: (scope, integration, snapshot, schemaHash) => {
    catalog.replaceOwnedContribution(scope, `mcp:${integration.id}`, {
      schemaVersion: 1,
      id: `integration.mcp.${integration.id}`,
      tools: createMcpTools(scope, integration, schemaHash, snapshot, repository, runtime, cryptoHash, artifacts),
    });
  },
  removed: (scope, integrationId) => catalog.removeOwned(scope, `mcp:${integrationId}`),
});
