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
  AgentWorkspaceRuntimeCleanupPreviewDto,
  AgentWorkspaceRuntimeCommandDto,
  AgentWorkspaceRuntimeConfirmationRequestDto,
  AgentWorkspaceRuntimeEmptyRequestDto,
  AgentWorkspaceRuntimeExpectedVersionRequestDto,
  AgentWorkspaceRuntimeSettingsResetPreviewDto,
  AgentWorkspaceRuntimeSettingsResetResultDto,
  AgentWorkspaceRuntimeSetupPreviewDto,
  AgentWorkspaceRuntimeSetupPreviewRequestDto,
  AgentWorkspaceRuntimeStorageDto,
  AgentWorkspaceToolchainSwitchDto,
  AgentWorkspaceToolVersionsFieldsDto,
  AgentWorkspaceToolVersionsRequestDto,
  AgentToolchainPackUninstallPreviewDto,
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
  async workspaceRuntimeStorage(): Promise<AgentWorkspaceRuntimeStorageDto> {
    return unwrap(
      (await httpClient.get<AgentEnvelopeDto<AgentWorkspaceRuntimeStorageDto>>('/agent/workspace-runtime/storage'))
        .data,
    );
  },
  async previewWorkspaceRuntimeSetup(
    recipes: AgentWorkspaceRuntimeSetupPreviewRequestDto['recipes'],
    expectedVersion: number,
  ): Promise<AgentWorkspaceRuntimeSetupPreviewDto> {
    const input: AgentWorkspaceRuntimeSetupPreviewRequestDto = { recipes, expectedVersion };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentWorkspaceRuntimeSetupPreviewDto>>(
          '/agent/workspace-runtime/setup/preview',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmWorkspaceRuntimeSetup(
    confirmationId: string,
    expectedVersion: number,
  ): Promise<AgentWorkspaceRuntimeCommandDto> {
    const input: AgentWorkspaceRuntimeConfirmationRequestDto = { confirmationId, expectedVersion };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentWorkspaceRuntimeCommandDto>>(
          '/agent/workspace-runtime/setup/confirm',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async installToolchainPack(familyId: string, versionId: string): Promise<AgentWorkspaceRuntimeCommandDto> {
    const input: AgentWorkspaceRuntimeEmptyRequestDto = {};
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentWorkspaceRuntimeCommandDto>>(
          `/agent/workspace-runtime/tool-packs/${encodeURIComponent(familyId)}/${encodeURIComponent(versionId)}/install`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async previewToolchainPackUninstall(
    familyId: string,
    versionId: string,
    expectedVersion: number,
  ): Promise<AgentToolchainPackUninstallPreviewDto> {
    const input: AgentWorkspaceRuntimeExpectedVersionRequestDto = { expectedVersion };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentToolchainPackUninstallPreviewDto>>(
          `/agent/workspace-runtime/tool-packs/${encodeURIComponent(familyId)}/${encodeURIComponent(versionId)}/uninstall/preview`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmToolchainPackUninstall(
    familyId: string,
    versionId: string,
    confirmationId: string,
    expectedVersion: number,
  ): Promise<AgentWorkspaceRuntimeCommandDto> {
    const input: AgentWorkspaceRuntimeConfirmationRequestDto = { confirmationId, expectedVersion };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentWorkspaceRuntimeCommandDto>>(
          `/agent/workspace-runtime/tool-packs/${encodeURIComponent(familyId)}/${encodeURIComponent(versionId)}/uninstall/confirm`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async previewWorkspaceRuntimeCleanup(expectedVersion: number): Promise<AgentWorkspaceRuntimeCleanupPreviewDto> {
    const input: AgentWorkspaceRuntimeExpectedVersionRequestDto = { expectedVersion };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentWorkspaceRuntimeCleanupPreviewDto>>(
          '/agent/workspace-runtime/runtime-cleanup/preview',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmWorkspaceRuntimeCleanup(
    confirmationId: string,
    expectedVersion: number,
  ): Promise<AgentWorkspaceRuntimeCommandDto> {
    const input: AgentWorkspaceRuntimeConfirmationRequestDto = { confirmationId, expectedVersion };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentWorkspaceRuntimeCommandDto>>(
          '/agent/workspace-runtime/runtime-cleanup/confirm',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async cleanupWorkspaceRuntimeCache(): Promise<AgentWorkspaceRuntimeCommandDto> {
    const input: AgentWorkspaceRuntimeEmptyRequestDto = {};
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentWorkspaceRuntimeCommandDto>>(
          '/agent/workspace-runtime/cache-cleanup',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async previewWorkspaceRuntimeSettingsReset(
    expectedVersion: number,
  ): Promise<AgentWorkspaceRuntimeSettingsResetPreviewDto> {
    const input: AgentWorkspaceRuntimeExpectedVersionRequestDto = { expectedVersion };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentWorkspaceRuntimeSettingsResetPreviewDto>>(
          '/agent/workspace-runtime/settings/reset/preview',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmWorkspaceRuntimeSettingsReset(
    confirmationId: string,
    expectedVersion: number,
  ): Promise<AgentWorkspaceRuntimeSettingsResetResultDto> {
    const input: AgentWorkspaceRuntimeConfirmationRequestDto = { confirmationId, expectedVersion };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentWorkspaceRuntimeSettingsResetResultDto>>(
          '/agent/workspace-runtime/settings/reset/confirm',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
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
