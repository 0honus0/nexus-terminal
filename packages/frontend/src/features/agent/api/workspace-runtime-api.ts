import { agentHttpClient as httpClient, agentRuntimeRequest } from './agent-http-client';
import type { AgentArtifactRefDto } from '@nexus-terminal/protocol/agent-artifacts';
import type { AgentEnvelopeDto } from '@nexus-terminal/protocol/agent-common';
import type {
  AgentWorkspaceActionFieldsDto,
  AgentWorkspaceActionRequestDto,
  AgentWorkspaceArtifactExportRequestDto,
  AgentWorkspaceArtifactImportRequestDto,
  AgentWorkspaceArtifactImportResultDto,
  AgentWorkspaceCreateFieldsDto,
  AgentWorkspaceCreateRequestDto,
  AgentWorkspaceDto,
  AgentWorkspaceEnvironmentSpecDto,
  AgentWorkspaceListQueryDto,
  AgentWorkspaceRuntimeAvailabilityDto,
  AgentWorkspaceRuntimeCatalogDto,
  AgentWorkspaceRuntimeCommandDto,
  AgentWorkspaceToolchainSwitchDto,
  AgentWorkspaceToolVersionsFieldsDto,
  AgentWorkspaceToolVersionsRequestDto,
} from '@nexus-terminal/protocol/agent-workspace-runtime';

const unwrap = <T>(envelope: AgentEnvelopeDto<T>): T => envelope.data;

export const createWorkspaceRuntimeApi = (mutationHeaders: () => Promise<Record<string, string>>) => ({
  async workspaceRuntimeAvailability(): Promise<AgentWorkspaceRuntimeAvailabilityDto> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentWorkspaceRuntimeAvailabilityDto>>(
          '/agent/workspace-runtime/availability',
        )
      ).data,
    );
  },
  async workspaceRuntimeCatalog(): Promise<AgentWorkspaceRuntimeCatalogDto> {
    return unwrap(
      (await httpClient.get<AgentEnvelopeDto<AgentWorkspaceRuntimeCatalogDto>>('/agent/workspace-runtime/catalog'))
        .data,
    );
  },
  async workspaceCommand(appId: string, commandId: string): Promise<AgentWorkspaceRuntimeCommandDto> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentWorkspaceRuntimeCommandDto>>(
          `/apps/${encodeURIComponent(appId)}/workspace-runtime/commands/${encodeURIComponent(commandId)}`,
        )
      ).data,
    );
  },
  async workspaceRuntimeCommand(commandId: string): Promise<AgentWorkspaceRuntimeCommandDto> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentWorkspaceRuntimeCommandDto>>(
          `/agent/workspace-runtime/commands/${encodeURIComponent(commandId)}`,
        )
      ).data,
    );
  },
  async workspaces(appId: string, runId: string, rootOnly = false): Promise<AgentWorkspaceDto[]> {
    const params: AgentWorkspaceListQueryDto | undefined = rootOnly ? { runtime: 'root' } : undefined;
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentWorkspaceDto[]>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/workspaces`,
          { params },
        )
      ).data,
    );
  },
  async workspace(appId: string, workspaceId: string): Promise<AgentWorkspaceDto> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentWorkspaceDto>>(
          `/apps/${encodeURIComponent(appId)}/workspaces/${encodeURIComponent(workspaceId)}`,
        )
      ).data,
    );
  },
  async createWorkspace(
    appId: string,
    runId: string,
    workspace: AgentWorkspaceEnvironmentSpecDto,
    retained = false,
    catalogRevision?: string,
  ): Promise<AgentWorkspaceDto> {
    const fields: AgentWorkspaceCreateFieldsDto = {
      workspace,
      retained,
      ...(catalogRevision ? { catalogRevision } : {}),
    };
    const input: AgentWorkspaceCreateRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentWorkspaceDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/workspaces`,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async workspaceAction(
    appId: string,
    workspace: AgentWorkspaceDto,
    action: 'start' | 'stop' | 'restart' | 'delete',
  ): Promise<AgentWorkspaceRuntimeCommandDto> {
    const fields: AgentWorkspaceActionFieldsDto = { action, expectedVersion: workspace.version };
    const input: AgentWorkspaceActionRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentWorkspaceRuntimeCommandDto>>(
          `/apps/${encodeURIComponent(appId)}/workspaces/${encodeURIComponent(workspace.id)}/actions`,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async switchWorkspaceToolVersions(
    appId: string,
    workspace: AgentWorkspaceDto,
    versions: Record<string, string>,
    catalogRevision: string,
  ): Promise<AgentWorkspaceToolchainSwitchDto> {
    const fields: AgentWorkspaceToolVersionsFieldsDto = {
      versions,
      expectedVersion: workspace.version,
      catalogRevision,
    };
    const input: AgentWorkspaceToolVersionsRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentWorkspaceToolchainSwitchDto>>(
          `/apps/${encodeURIComponent(appId)}/workspaces/${encodeURIComponent(workspace.id)}/tool-versions`,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async exportWorkspaceArtifact(
    appId: string,
    workspaceId: string,
    targetPluginId: string,
    input: AgentWorkspaceArtifactExportRequestDto,
  ): Promise<AgentArtifactRefDto> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentArtifactRefDto>>(
          `/apps/${encodeURIComponent(appId)}/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(targetPluginId)}/artifacts/export`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async importArtifactToWorkspace(
    appId: string,
    workspaceId: string,
    targetPluginId: string,
    input: AgentWorkspaceArtifactImportRequestDto,
  ): Promise<AgentWorkspaceArtifactImportResultDto> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentWorkspaceArtifactImportResultDto>>(
          `/apps/${encodeURIComponent(appId)}/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(targetPluginId)}/artifacts/import`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
});
