import type { AgentSettingsService } from '../../modules/agent/host/agent-settings.service';
import type { ArtifactService } from '../../modules/agent/ai/artifact.service';
import type { IntegrationRepositoryPort } from '../../modules/agent/ai/integration.repository.port';
import type { IntegrationServiceHooks } from '../../modules/agent/ai/integration.service';
import type { AcpRuntimePort, BrowserGatewayPort, McpRuntimePort } from '../../modules/agent/ai/integrations.types';
import type { MemoryService } from '../../modules/agent/ai/memory.service';
import type { SkillRegistry } from '../../modules/agent/ai/skill-registry';
import { createCollaborationTools } from '../../modules/agent/tools/host/collaboration-tools';
import { createUnifiedFileTools } from '../../modules/agent/tools/host/file-tools';
import { createMcpTools } from '../../modules/agent/tools/host/mcp-tools';
import { createAcpExecuteTool } from '../../modules/agent/tools/host/acp-tools';
import { createBrowserTools } from '../../modules/agent/tools/host/browser-tools';
import { createDockerMutationTool } from '../../modules/agent/tools/host/mutation-tools';
import { createConnectionListTool, createDiagnosticsTool } from '../../modules/agent/tools/host/tools';
import { createSkillReadTool, createSkillSearchTool } from '../../modules/agent/tools/host/skill-tools';
import { createRequestUserInputTool } from '../../modules/agent/tools/host/user-input-tools';
import { createToolSearchTool } from '../../modules/agent/tools/host/tool-discovery-tools';
import { createArtifactReadTool } from '../../modules/agent/tools/host/artifact-tools';
import { createToolResultReadTool } from '../../modules/agent/tools/host/tool-result-read-tool';
import type { ToolResultReaderPort } from '../../modules/agent/runtime/runs/run.repository.port';
import type { CryptoHashPort } from '../../modules/agent/crypto-hash.port';
import type { FileCapabilityService } from '../../modules/agent/capabilities/file-capability.service';
import type { MachineCapabilityPort } from '../../modules/agent/capabilities/machine.port';
import type { SshTargetResolverPort } from '../../modules/agent/capabilities/ssh-target-resolver.port';
import type { ShellCapabilityService } from '../../modules/agent/capabilities/shell-capability.service';
import type { ToolCatalog } from '../../modules/agent/capabilities/tool-catalog';
import type { MailboxService } from '../../modules/agent/runtime/collaboration/mailbox.service';
import type { SharedFactsService } from '../../modules/agent/runtime/collaboration/shared-facts.service';
import type { AcpPermissionRequestPort } from '../../modules/agent/runtime/approvals/acp-permission-broker';
import type { SubagentService } from '../../modules/agent/runtime/collaboration/subagent.service';
import { createPlanUpdateTool } from '../../modules/agent/runtime/planning/plan-tool';
import type { PlanService } from '../../modules/agent/runtime/planning/plan.service';
import type { RunSnapshotReaderPort } from '../../modules/agent/runtime/runs/run.repository.port';
import { createUnifiedShellTools } from '../../modules/agent/tools/host/shell-tools';

export interface FileToolContributionOptions {
  catalog: ToolCatalog;
  files: FileCapabilityService;
  cryptoHash: CryptoHashPort;
}

export const registerFileToolContributions = ({ catalog, files, cryptoHash }: FileToolContributionOptions): void => {
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'file.tools',
    tools: createUnifiedFileTools(files, cryptoHash),
  });
};

export interface MachineToolContributionOptions {
  catalog: ToolCatalog;
  machine: MachineCapabilityPort;
  sshTargets: SshTargetResolverPort;
  cryptoHash: CryptoHashPort;
}

export const registerMachineToolContributions = ({
  catalog,
  machine,
  sshTargets,
  cryptoHash,
}: MachineToolContributionOptions): void => {
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.inspect',
    tools: [createConnectionListTool(machine, cryptoHash), createDiagnosticsTool(machine, sshTargets, cryptoHash)],
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.docker',
    tools: [createDockerMutationTool(machine, sshTargets, cryptoHash)],
  });
};

export interface ShellToolContributionOptions {
  catalog: ToolCatalog;
  shell: ShellCapabilityService;
  cryptoHash: CryptoHashPort;
}

export const registerShellToolContributions = ({ catalog, shell, cryptoHash }: ShellToolContributionOptions): void => {
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'shell.tools',
    tools: createUnifiedShellTools(shell, cryptoHash),
  });
};

export interface RuntimeToolContributionOptions {
  catalog: ToolCatalog;
  artifacts: ArtifactService;
  plans: PlanService;
  runs: RunSnapshotReaderPort & ToolResultReaderPort;
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
    tools: [createArtifactReadTool(artifacts, cryptoHash), createToolResultReadTool(runs, cryptoHash)],
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
  ssh: Parameters<typeof createAcpExecuteTool>[4];
  catalog: ToolCatalog;
  repository: IntegrationRepositoryPort;
  runtime: AcpRuntimePort;
  cryptoHash: CryptoHashPort;
  permissionRequests: AcpPermissionRequestPort;
}

export const registerAcpToolContribution = ({
  catalog,
  repository,
  runtime,
  cryptoHash,
  permissionRequests,
  ssh,
}: AcpToolContributionOptions): void => {
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'integration.acp.invoke',
    tools: [createAcpExecuteTool(repository, runtime, cryptoHash, permissionRequests, ssh)],
  });
};

export interface BrowserToolContributionOptions {
  catalog: ToolCatalog;
  settings: AgentSettingsService;
  gateway: BrowserGatewayPort;
  cryptoHash: CryptoHashPort;
  artifacts: ArtifactService;
}

export const registerBrowserToolContribution = ({
  catalog,
  settings,
  gateway,
  cryptoHash,
  artifacts,
}: BrowserToolContributionOptions): void => {
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'browser.tools',
    tools: createBrowserTools(settings, gateway, cryptoHash, artifacts),
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
