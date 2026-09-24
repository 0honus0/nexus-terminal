import type { AgentArtifactRefDto, AgentEnvelopeDto } from './agent-api.types';
import type {
  AgentAppIntentArtifactDto,
  AgentAppIntentCreateRequestDto,
  AgentAppIntentListQueryDto,
  AgentAppIntentReceiptDto,
  AgentPluginArtifactStageRequestDto,
  AgentPluginDeleteDataRequestDto,
  AgentPluginFrontendDescriptorDto,
  AgentPluginFrontendRpcMethodDto,
  AgentPluginFrontendRpcRequestDto,
  AgentPluginFrontendRpcResponseDto,
  AgentPluginInstallationDto,
  AgentPluginInstallResultDto,
  AgentPluginOfficialStageRequestDto,
  AgentPluginPublisherKeyDto,
  AgentPluginRemoteCatalogQueryDto,
  AgentPluginRemoteStageRequestDto,
  AgentPluginStageDto,
  AgentPluginStageIdRequestDto,
  AgentPluginTrustPublisherRequestDto,
  AgentPluginUninstallRequestDto,
  AgentPluginUninstallResultDto,
  AgentPluginUpgradeRequestDto,
  AgentPluginUpgradeResultDto,
  AgentPluginVerifyResultDto,
  AgentPluginVersionDto,
  AgentPluginVersionsQueryDto,
  AgentRemotePluginCatalogDto,
} from '@nexus-terminal/protocol/agent-plugins';
import { httpClient, mutationHeaders, unwrap } from './agent-api-common';

export const createPluginApi = () => ({
  async pluginPublishers(): Promise<AgentPluginPublisherKeyDto[]> {
    return unwrap(
      (await httpClient.get<AgentEnvelopeDto<AgentPluginPublisherKeyDto[]>>('/agent/plugins/publishers')).data,
    );
  },
  async trustPluginPublisher(publicKeyPem: string, label: string): Promise<AgentPluginPublisherKeyDto> {
    const input: AgentPluginTrustPublisherRequestDto = { publicKeyPem, label };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentPluginPublisherKeyDto>>('/agent/plugins/publishers', input, {
          headers: await mutationHeaders(),
        })
      ).data,
    );
  },
  async revokePluginPublisher(keyId: string): Promise<void> {
    await httpClient.delete(`/agent/plugins/publishers/${encodeURIComponent(keyId)}`, {
      headers: await mutationHeaders(),
    });
  },
  async pluginInstallations(): Promise<AgentPluginInstallationDto[]> {
    return unwrap(
      (await httpClient.get<AgentEnvelopeDto<AgentPluginInstallationDto[]>>('/agent/plugins/installations')).data,
    );
  },
  async pluginVersions(appId?: string): Promise<AgentPluginVersionDto[]> {
    const params: AgentPluginVersionsQueryDto | undefined = appId ? { appId } : undefined;
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentPluginVersionDto[]>>('/agent/plugins/versions', {
          params,
        })
      ).data,
    );
  },
  async officialPluginCatalog(): Promise<AgentRemotePluginCatalogDto> {
    return unwrap(
      (await httpClient.get<AgentEnvelopeDto<AgentRemotePluginCatalogDto>>('/agent/plugins/official/catalog')).data,
    );
  },
  async stageOfficialPlugin(appId: string, version: string): Promise<AgentPluginStageDto> {
    const input: AgentPluginOfficialStageRequestDto = { appId, version };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentPluginStageDto>>('/agent/plugins/official/stage', input, {
          headers: await mutationHeaders(),
        })
      ).data,
    );
  },
  async remotePluginCatalog(repositoryUrl: string): Promise<AgentRemotePluginCatalogDto> {
    const params: AgentPluginRemoteCatalogQueryDto = { repositoryUrl };
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentRemotePluginCatalogDto>>('/agent/plugins/remote/catalog', {
          params,
        })
      ).data,
    );
  },
  async stageRemotePlugin(repositoryUrl: string, appId: string, version: string): Promise<AgentPluginStageDto> {
    const input: AgentPluginRemoteStageRequestDto = { repositoryUrl, appId, version };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentPluginStageDto>>('/agent/plugins/remote/stage', input, {
          headers: await mutationHeaders(),
        })
      ).data,
    );
  },
  async stagePlugin(artifact: AgentArtifactRefDto): Promise<AgentPluginStageDto> {
    const input: AgentPluginArtifactStageRequestDto = { artifactRef: { appId: artifact.appId, id: artifact.id } };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentPluginStageDto>>('/agent/plugins/stage', input, {
          headers: await mutationHeaders(),
        })
      ).data,
    );
  },
  async verifyPlugin(stageId: string): Promise<AgentPluginVerifyResultDto> {
    const input: AgentPluginStageIdRequestDto = { stageId };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentPluginVerifyResultDto>>('/agent/plugins/verify', input, {
          headers: await mutationHeaders(),
        })
      ).data,
    );
  },
  async installPlugin(stageId: string): Promise<AgentPluginInstallResultDto> {
    const input: AgentPluginStageIdRequestDto = { stageId };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentPluginInstallResultDto>>('/agent/plugins/install', input, {
          headers: await mutationHeaders(),
        })
      ).data,
    );
  },
  async upgradePlugin(appId: string, stageId: string, expectedVersion: number): Promise<AgentPluginUpgradeResultDto> {
    const input: AgentPluginUpgradeRequestDto = { stageId, expectedVersion };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentPluginUpgradeResultDto>>(
          `/agent/plugins/${encodeURIComponent(appId)}/upgrade`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async uninstallPlugin(appId: string, expectedVersion: number): Promise<AgentPluginUninstallResultDto> {
    const input: AgentPluginUninstallRequestDto = { deleteData: false, expectedVersion };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentPluginUninstallResultDto>>(
          `/agent/plugins/${encodeURIComponent(appId)}/uninstall`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deletePluginData(appId: string, confirmed: true): Promise<void> {
    const input: AgentPluginDeleteDataRequestDto = { confirmed };
    await httpClient.post(`/agent/plugins/${encodeURIComponent(appId)}/delete-data`, input, {
      headers: await mutationHeaders(),
    });
  },
  async pluginFrontend(appId: string): Promise<AgentPluginFrontendDescriptorDto> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentPluginFrontendDescriptorDto>>(
          `/agent/plugins/${encodeURIComponent(appId)}/frontend`,
        )
      ).data,
    );
  },
  async createAppIntent(
    appId: string,
    input: AgentAppIntentCreateRequestDto,
    idempotencyKey: string,
  ): Promise<AgentAppIntentReceiptDto> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentAppIntentReceiptDto>>(
          `/agent/apps/${encodeURIComponent(appId)}/plugin-intents`,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': idempotencyKey } },
        )
      ).data,
    );
  },
  async listReceivedAppIntents(appId: string, limit?: number): Promise<AgentAppIntentReceiptDto[]> {
    const params: AgentAppIntentListQueryDto | undefined = limit === undefined ? undefined : { limit };
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentAppIntentReceiptDto[]>>(
          `/agent/apps/${encodeURIComponent(appId)}/plugin-intents`,
          params === undefined ? undefined : { params },
        )
      ).data,
    );
  },
  async revokeAppIntent(appId: string, receiptId: string): Promise<void> {
    await httpClient.delete(
      `/agent/apps/${encodeURIComponent(appId)}/plugin-intents/${encodeURIComponent(receiptId)}`,
      { headers: await mutationHeaders() },
    );
  },
  async getReceivedAppIntentArtifact(
    appId: string,
    receiptId: string,
    artifactId: string,
  ): Promise<AgentAppIntentArtifactDto> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentAppIntentArtifactDto>>(
          `/agent/apps/${encodeURIComponent(appId)}/plugin-intents/${encodeURIComponent(receiptId)}/artifacts/${encodeURIComponent(artifactId)}`,
        )
      ).data,
    );
  },
  async readReceivedAppIntentArtifactRange(
    appId: string,
    receiptId: string,
    artifactId: string,
    start: number,
    endInclusive: number,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    const response = await httpClient.get<ArrayBuffer>(
      `/agent/apps/${encodeURIComponent(appId)}/plugin-intents/${encodeURIComponent(receiptId)}/artifacts/${encodeURIComponent(artifactId)}/content`,
      {
        headers: { Range: `bytes=${start}-${endInclusive}` },
        responseType: 'arraybuffer',
        signal,
      },
    );
    return response.data;
  },
  async pluginFrontendRpc(
    appId: string,
    version: string,
    method: AgentPluginFrontendRpcMethodDto,
    params: AgentPluginFrontendRpcRequestDto['params'],
    operationId?: string,
    signal?: AbortSignal,
  ): Promise<AgentPluginFrontendRpcResponseDto> {
    const input: AgentPluginFrontendRpcRequestDto = {
      version,
      method,
      params,
      ...(operationId ? { operationId } : {}),
    };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentPluginFrontendRpcResponseDto>>(
          `/agent/plugins/${encodeURIComponent(appId)}/frontend/rpc`,
          input,
          { headers: await mutationHeaders(), signal },
        )
      ).data,
    );
  },
});
