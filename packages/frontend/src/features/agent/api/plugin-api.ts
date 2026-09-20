import type { AgentArtifactRef, AgentEnvelope } from './agent-api.types';
import type {
  AgentAppIntentArtifactView,
  AgentAppIntentReceipt,
  PluginAppStateView,
  PluginFrontendDescriptor,
  PluginInstallation,
  PluginPublisherKey,
  PluginStageView,
  PluginUninstallResult,
  PluginUpgradeResult,
  PluginVerifyResult,
  PluginVersionView,
  RemotePluginCatalog,
} from './agent-api';
import { httpClient, mutationHeaders, unwrap } from './agent-api-common';

export const createPluginApi = () => ({
  async pluginPublishers(): Promise<PluginPublisherKey[]> {
    return unwrap((await httpClient.get<AgentEnvelope<PluginPublisherKey[]>>('/agent/plugins/publishers')).data);
  },
  async trustPluginPublisher(publicKeyPem: string, label: string): Promise<PluginPublisherKey> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<PluginPublisherKey>>(
          '/agent/plugins/publishers',
          { publicKeyPem, label },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async revokePluginPublisher(keyId: string): Promise<void> {
    await httpClient.delete(`/agent/plugins/publishers/${encodeURIComponent(keyId)}`, {
      headers: await mutationHeaders(),
    });
  },
  async pluginInstallations(): Promise<PluginInstallation[]> {
    return unwrap((await httpClient.get<AgentEnvelope<PluginInstallation[]>>('/agent/plugins/installations')).data);
  },
  async pluginVersions(appId?: string): Promise<PluginVersionView[]> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<PluginVersionView[]>>('/agent/plugins/versions', {
          params: appId ? { appId } : undefined,
        })
      ).data,
    );
  },
  async officialPluginCatalog(): Promise<RemotePluginCatalog> {
    return unwrap((await httpClient.get<AgentEnvelope<RemotePluginCatalog>>('/agent/plugins/official/catalog')).data);
  },
  async stageOfficialPlugin(appId: string, version: string): Promise<PluginStageView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<PluginStageView>>(
          '/agent/plugins/official/stage',
          { appId, version },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async remotePluginCatalog(repositoryUrl: string): Promise<RemotePluginCatalog> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<RemotePluginCatalog>>('/agent/plugins/remote/catalog', {
          params: { repositoryUrl },
        })
      ).data,
    );
  },
  async stageRemotePlugin(repositoryUrl: string, appId: string, version: string): Promise<PluginStageView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<PluginStageView>>(
          '/agent/plugins/remote/stage',
          { repositoryUrl, appId, version },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async stagePlugin(artifact: AgentArtifactRef): Promise<PluginStageView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<PluginStageView>>(
          '/agent/plugins/stage',
          { artifactRef: { appId: artifact.appId, id: artifact.id } },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async verifyPlugin(stageId: string): Promise<PluginVerifyResult> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<PluginVerifyResult>>(
          '/agent/plugins/verify',
          { stageId },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async installPlugin(
    stageId: string,
  ): Promise<{ stage: PluginStageView; plugin: PluginVersionView; app: PluginAppStateView }> {
    return unwrap(
      (
        await httpClient.post<
          AgentEnvelope<{ stage: PluginStageView; plugin: PluginVersionView; app: PluginAppStateView }>
        >('/agent/plugins/install', { stageId }, { headers: await mutationHeaders() })
      ).data,
    );
  },
  async upgradePlugin(appId: string, stageId: string, expectedVersion: number): Promise<PluginUpgradeResult> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<PluginUpgradeResult>>(
          `/agent/plugins/${encodeURIComponent(appId)}/upgrade`,
          { stageId, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async uninstallPlugin(appId: string, expectedVersion: number): Promise<PluginUninstallResult> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<PluginUninstallResult>>(
          `/agent/plugins/${encodeURIComponent(appId)}/uninstall`,
          { deleteData: false, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deletePluginData(appId: string, confirmed: true): Promise<void> {
    await httpClient.post(
      `/agent/plugins/${encodeURIComponent(appId)}/delete-data`,
      { confirmed },
      { headers: await mutationHeaders() },
    );
  },
  async pluginFrontend(appId: string): Promise<PluginFrontendDescriptor> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<PluginFrontendDescriptor>>(
          `/agent/plugins/${encodeURIComponent(appId)}/frontend`,
        )
      ).data,
    );
  },
  async createAppIntent(
    appId: string,
    input: {
      receiverAppId: string;
      intentId: string;
      input: unknown;
      artifactRefs: Array<{ appId: string; id: string }>;
      confirmed: true;
    },
  ): Promise<AgentAppIntentReceipt> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentAppIntentReceipt>>(
          `/agent/apps/${encodeURIComponent(appId)}/plugin-intents`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async listReceivedAppIntents(appId: string, limit?: number): Promise<AgentAppIntentReceipt[]> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentAppIntentReceipt[]>>(
          `/agent/apps/${encodeURIComponent(appId)}/plugin-intents`,
          limit === undefined ? undefined : { params: { limit } },
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
  ): Promise<AgentAppIntentArtifactView> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentAppIntentArtifactView>>(
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
    method:
      | 'host.appInfo'
      | 'storage.get'
      | 'storage.put'
      | 'storage.delete'
      | 'intents.create'
      | 'intents.listReceived'
      | 'intents.revoke'
      | 'intents.artifacts.get',
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<unknown>>(
          `/agent/plugins/${encodeURIComponent(appId)}/frontend/rpc`,
          { method, params },
          { headers: await mutationHeaders(), signal },
        )
      ).data,
    );
  },
});
