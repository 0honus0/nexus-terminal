import type {
  AgentAppIntentArtifactDto,
  AgentAppIntentReceiptDto,
  AgentPluginAppStateDto,
  AgentPluginFrontendDescriptorDto,
  AgentPluginInstallResultDto,
  AgentPluginInstallationDto,
  AgentPluginManifestDto,
  AgentPluginPendingUpgradeDto,
  AgentPluginPublisherKeyDto,
  AgentPluginStageDto,
  AgentPluginUninstallResultDto,
  AgentPluginUpgradeResultDto,
  AgentPluginVerifyResultDto,
  AgentPluginVersionDto,
  AgentRemotePluginCatalogDto,
} from '@nexus-terminal/protocol/agent-plugins';
import type { AgentHostFacade, AgentPluginFacade } from '../../../modules/agent/public';

type Publisher = Awaited<ReturnType<AgentPluginFacade['listPublisherKeys']>>[number];
type Installation = Awaited<ReturnType<AgentPluginFacade['listInstallations']>>[number];
type Version = Awaited<ReturnType<AgentPluginFacade['listVersions']>>[number];
type Stage = Awaited<ReturnType<AgentPluginFacade['stage']>>;
type Catalog = Awaited<ReturnType<AgentPluginFacade['officialCatalog']>>;
type InstallResult = Awaited<ReturnType<AgentPluginFacade['install']>>;
type PendingUpgrade = Awaited<ReturnType<AgentPluginFacade['listPendingUpgrades']>>[number];
type UpgradeResult = Awaited<ReturnType<AgentPluginFacade['upgrade']>>;
type UninstallResult = Awaited<ReturnType<AgentPluginFacade['uninstall']>>;
type FrontendDescriptor = NonNullable<Awaited<ReturnType<AgentPluginFacade['frontendDescriptor']>>>;
type IntentReceipt = Awaited<ReturnType<AgentHostFacade['listReceivedAppIntents']>>[number];
type IntentArtifact = Awaited<ReturnType<AgentHostFacade['getReceivedAppIntentArtifact']>>;

export const pluginManifestDto = (manifest: Version['manifest']): AgentPluginManifestDto => ({
  schemaVersion: 1,
  id: manifest.id,
  version: manifest.version,
  displayName: manifest.displayName,
  sdkVersion: manifest.sdkVersion,
  nexus: { ...manifest.nexus },
  capabilities: [...manifest.capabilities],
  intents: manifest.intents.map((intent) => ({ id: intent.id, schemaVersion: intent.schemaVersion })),
  ...(manifest.agents === undefined
    ? {}
    : {
        agents: manifest.agents.map((agent) => ({
          id: agent.id,
          version: agent.version,
          displayName: agent.displayName,
          description: agent.description,
          requiredModelCapabilities: [...agent.requiredModelCapabilities],
        })),
      }),
  ...(manifest.agentSurface === undefined
    ? {}
    : {
        agentSurface: {
          ...(manifest.agentSurface.defaultApprovalMode === undefined
            ? {}
            : { defaultApprovalMode: manifest.agentSurface.defaultApprovalMode }),
        },
      }),
  ...(manifest.targets === undefined
    ? {}
    : {
        targets: {
          ...(manifest.targets.frontend === undefined ? {} : { frontend: { entry: manifest.targets.frontend.entry } }),
          ...(manifest.targets.backend === undefined ? {} : { backend: { entry: manifest.targets.backend.entry } }),
          ...(manifest.targets.runner === undefined ? {} : { runner: { entry: manifest.targets.runner.entry } }),
        },
      }),
});

export const pluginPublisherDto = (key: Publisher): AgentPluginPublisherKeyDto => ({
  userId: key.userId,
  keyId: key.keyId,
  label: key.label,
  createdAt: key.createdAt,
  revokedAt: key.revokedAt,
});

export const pluginInstallationDto = (installation: Installation): AgentPluginInstallationDto => ({
  userId: installation.userId,
  appId: installation.appId,
  version: installation.version,
  status: installation.status,
  retainedDataEntries: installation.retainedDataEntries,
  retainedDataBytes: installation.retainedDataBytes,
  createdAt: installation.createdAt,
  updatedAt: installation.updatedAt,
});

export const pluginVersionDto = (plugin: Version): AgentPluginVersionDto => ({
  appId: plugin.appId,
  version: plugin.version,
  packageHash: plugin.packageHash,
  publisherKeyId: plugin.publisherKeyId,
  manifest: pluginManifestDto(plugin.manifest),
  frontendEntry: plugin.frontendEntry,
  backendEntry: plugin.backendEntry,
  runnerEntry: plugin.runnerEntry,
  skillFiles: [...plugin.skillFiles],
  status: plugin.status,
  installedAt: plugin.installedAt,
  updatedAt: plugin.updatedAt,
});

export const pluginStageDto = (stage: Stage): AgentPluginStageDto => ({
  id: stage.id,
  userId: stage.userId,
  source: stage.source.kind === 'artifact' ? { ...stage.source } : { ...stage.source },
  packageHash: stage.packageHash,
  sizeBytes: stage.sizeBytes,
  publisherKeyId: stage.publisherKeyId,
  appId: stage.appId,
  version: stage.version,
  manifest: stage.manifest === null ? null : pluginManifestDto(stage.manifest as Version['manifest']),
  status: stage.status,
  errorCode: stage.errorCode,
  createdAt: stage.createdAt,
  updatedAt: stage.updatedAt,
  versionNumber: stage.versionNumber,
});

export const remotePluginCatalogDto = (catalog: Catalog): AgentRemotePluginCatalogDto => ({
  schemaVersion: 1,
  repositoryUrl: catalog.repositoryUrl,
  publishers: catalog.publishers.map((publisher) => ({
    keyId: publisher.keyId,
    label: publisher.label,
    publicKeyPem: publisher.publicKeyPem,
  })),
  packages: catalog.packages.map((entry) => ({
    appId: entry.appId,
    version: entry.version,
    sdkVersion: entry.sdkVersion,
    nexus: { ...entry.nexus },
    ...(entry.compatible === undefined ? {} : { compatible: entry.compatible }),
    displayName: entry.displayName,
    description: entry.description,
    packageUrl: entry.packageUrl,
    sha256: entry.sha256,
    sizeBytes: entry.sizeBytes,
    publisherKeyId: entry.publisherKeyId,
  })),
});

export const pluginAppStateDto = (app: InstallResult['app']): AgentPluginAppStateDto => ({
  userId: app.userId,
  appId: app.appId,
  activeVersion: app.activeVersion,
  desiredState: app.desiredState,
  observedState: app.observedState,
  healthReason: app.healthReason,
  policyRevision: app.policyRevision,
  runningCount: app.runningCount,
  approvalCount: app.approvalCount,
  budgetRequestCount: app.budgetRequestCount,
  acceptNewRuns: app.acceptNewRuns,
  version: app.version,
  createdAt: app.createdAt,
  updatedAt: app.updatedAt,
  displayName: app.displayName,
  capabilities: [...app.capabilities],
  surface: app.surface,
  defaultApprovalMode: app.defaultApprovalMode,
});

export const pluginVerifyResultDto = (
  result: Awaited<ReturnType<AgentPluginFacade['verify']>>,
): AgentPluginVerifyResultDto => ({
  stage: pluginStageDto(result.stage),
  plugin: pluginVersionDto(result.plugin),
});

export const pluginInstallResultDto = (result: InstallResult): AgentPluginInstallResultDto => ({
  stage: pluginStageDto(result.stage),
  plugin: pluginVersionDto(result.plugin),
  app: pluginAppStateDto(result.app),
});

export const pluginUpgradeResultDto = (result: UpgradeResult): AgentPluginUpgradeResultDto => ({
  state: result.state,
  targetVersion: result.targetVersion,
  app: pluginAppStateDto(result.app),
  plugin: pluginVersionDto(result.plugin),
});

export const pluginPendingUpgradeDto = (pending: PendingUpgrade): AgentPluginPendingUpgradeDto => ({
  appId: pending.appId,
  fromVersion: pending.fromVersion,
  targetVersion: pending.targetVersion,
  expectedVersion: pending.appStateVersion,
  stage: pluginStageDto(pending.stage),
  plugin: pluginVersionDto(pending.plugin),
  app: pluginAppStateDto(pending.app),
});

export const pluginUninstallResultDto = (result: UninstallResult): AgentPluginUninstallResultDto => ({
  state: result.state,
  app: pluginAppStateDto(result.app),
});

export const pluginFrontendDescriptorDto = (descriptor: FrontendDescriptor): AgentPluginFrontendDescriptorDto => ({
  appId: descriptor.appId,
  version: descriptor.version,
  sdkVersion: descriptor.sdkVersion,
  protocolVersion: 1,
  url: descriptor.url,
  sandbox: 'allow-scripts',
  maxMessageBytes: 256000,
  requestTimeoutMs: 15000,
});

export const appIntentReceiptDto = (receipt: IntentReceipt): AgentAppIntentReceiptDto => ({
  id: receipt.id,
  userId: receipt.userId,
  senderAppId: receipt.senderAppId,
  receiverAppId: receipt.receiverAppId,
  intentId: receipt.intentId,
  schemaVersion: receipt.schemaVersion,
  input: receipt.input,
  artifactIds: [...receipt.artifactIds],
  createdAt: receipt.createdAt,
  expiresAt: receipt.expiresAt,
  revokedAt: receipt.revokedAt,
});

export const appIntentArtifactDto = (artifact: IntentArtifact): AgentAppIntentArtifactDto => ({
  id: artifact.id,
  appId: artifact.appId,
  originalName: artifact.originalName,
  mediaType: artifact.mediaType,
  sizeBytes: artifact.sizeBytes,
  sha256: artifact.sha256,
});
