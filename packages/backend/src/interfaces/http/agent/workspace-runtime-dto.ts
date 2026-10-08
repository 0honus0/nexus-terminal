import type {
  AgentWorkspaceArtifactImportResultDto,
  AgentWorkspaceDto,
  AgentWorkspaceRuntimeAvailabilityDto,
  AgentWorkspaceRuntimeCatalogDto,
  AgentWorkspaceRuntimeCommandDto,
  AgentWorkspaceToolchainSwitchDto,
} from '@nexus-terminal/protocol/agent-workspace-runtime';
import type { AgentWorkspaceRuntimeFacade } from '../../../modules/agent/public';
import { artifactDto } from './artifact-dto';
import { runEnvironmentDto } from './run-dto';

type Workspace = Awaited<ReturnType<AgentWorkspaceRuntimeFacade['getWorkspace']>>;
type Command = Awaited<ReturnType<AgentWorkspaceRuntimeFacade['getCommand']>>;
type Catalog = Awaited<ReturnType<AgentWorkspaceRuntimeFacade['catalog']>>;
type ToolchainSwitch = Awaited<ReturnType<AgentWorkspaceRuntimeFacade['switchToolVersions']>>;
type ArtifactImport = Awaited<ReturnType<AgentWorkspaceRuntimeFacade['importArtifactToWorkspace']>>;

export const workspaceRuntimeAvailabilityDto = (
  value: Awaited<ReturnType<AgentWorkspaceRuntimeFacade['availability']>>,
): AgentWorkspaceRuntimeAvailabilityDto => ({
  available: value.available,
  reason: value.reason,
  mode: value.mode,
  isolation: value.isolation,
});

export const workspaceRuntimeCatalogDto = (value: Catalog): AgentWorkspaceRuntimeCatalogDto => ({
  revision: value.revision,
  runtimeDigest: value.runtimeDigest,
  recipes: value.recipes.map((recipe) => ({
    id: recipe.id,
    revision: recipe.revision,
    kind: recipe.kind,
    displayName: recipe.displayName,
    allowedFamilies: [...recipe.allowedFamilies],
    defaultFamilies: [...recipe.defaultFamilies],
  })),
  packs: value.packs.map((pack) => ({
    familyId: pack.familyId,
    versionId: pack.versionId,
    displayName: pack.displayName,
    diskBytes: pack.diskBytes,
    status: pack.status,
    installed: pack.installed,
    enabled: pack.enabled,
    inUse: pack.inUse,
  })),
});

export const workspaceDto = (workspace: Workspace): AgentWorkspaceDto => ({
  id: workspace.id,
  userId: workspace.userId,
  appId: workspace.appId,
  runId: workspace.runId,
  agentRuntimeId: workspace.agentRuntimeId,
  retained: workspace.retained,
  profile: runEnvironmentDto(workspace.profile)!,
  generation: workspace.generation,
  status: workspace.status,
  retainedManifestRef: workspace.retainedManifestRef,
  version: workspace.version,
  lastActiveAt: workspace.lastActiveAt,
  createdAt: workspace.createdAt,
  updatedAt: workspace.updatedAt,
});

export const workspaceRuntimeCommandDto = (command: Command): AgentWorkspaceRuntimeCommandDto => ({
  id: command.id,
  userId: command.userId,
  appId: command.appId,
  workspaceId: command.workspaceId,
  action: command.action,
  operationHash: command.operationHash,
  generation: command.generation,
  status: command.status,
  result: command.result,
  deadlineAt: command.deadlineAt,
  createdAt: command.createdAt,
  completedAt: command.completedAt,
});

export const workspaceToolchainSwitchDto = (value: ToolchainSwitch): AgentWorkspaceToolchainSwitchDto => ({
  outcome: value.outcome,
  workspace: workspaceDto(value.workspace),
  commands: value.commands.map(workspaceRuntimeCommandDto),
});

export const workspaceArtifactImportResultDto = (value: ArtifactImport): AgentWorkspaceArtifactImportResultDto => ({
  artifact: artifactDto(value.artifact),
  workspaceId: value.workspaceId,
  targetPluginId: value.targetPluginId,
  path: value.path,
  writtenBytes: value.writtenBytes,
});
