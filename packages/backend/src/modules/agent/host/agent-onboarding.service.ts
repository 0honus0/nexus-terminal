import { rcompare } from 'semver';
import type { AppGrantRepositoryPort } from './app-grant.repository.port';
import type { AppLifecycleService } from './app-lifecycle.service';
import type { AppView } from './app.types';
import type { OfficialAgentPluginSource } from './official-plugin-source';
import type { PluginInstallService } from './plugin-install.service';

export interface RecommendedAgentPluginView {
  appId: string;
  installed: boolean;
  installedVersion: string | null;
  enabled: boolean;
  availableVersion: string;
  displayName: string;
  description: string;
  catalogUrl: string;
  publisherKeyId: string;
}

export interface RecommendedAgentPluginInstallResult {
  app: AppView;
  installedNow: boolean;
}

export class AgentOnboardingService {
  constructor(
    private readonly plugins: PluginInstallService,
    private readonly lifecycle: AppLifecycleService,
    private readonly grants: AppGrantRepositoryPort,
    private readonly source: OfficialAgentPluginSource,
  ) {}

  async recommended(userId: number, signal?: AbortSignal): Promise<RecommendedAgentPluginView> {
    const catalog = await this.requireOfficialCatalog(signal);
    const entry = catalog.packages
      .filter(
        (candidate) =>
          candidate.appId === this.source.recommendedAppId && candidate.publisherKeyId === this.source.publisherKeyId,
      )
      .sort((left, right) => rcompare(left.version, right.version))[0];
    if (!entry) throw new Error('OFFICIAL_RECOMMENDED_PLUGIN_UNAVAILABLE');
    const installation = (await this.plugins.listInstallations(userId)).find(
      (candidate) => candidate.appId === this.source.recommendedAppId && candidate.status === 'installed',
    );
    let enabled = false;
    if (installation) {
      const app = await this.lifecycle.get({ userId, appId: this.source.recommendedAppId });
      enabled = app.desiredState === 'enabled';
    }
    return {
      appId: entry.appId,
      installed: Boolean(installation),
      installedVersion: installation?.version ?? null,
      enabled,
      availableVersion: entry.version,
      displayName: entry.displayName,
      description: entry.description,
      catalogUrl: catalog.repositoryUrl,
      publisherKeyId: entry.publisherKeyId,
    };
  }

  async installRecommended(userId: number, signal?: AbortSignal): Promise<RecommendedAgentPluginInstallResult> {
    const existing = (await this.plugins.listInstallations(userId)).find(
      (candidate) => candidate.appId === this.source.recommendedAppId && candidate.status === 'installed',
    );
    if (existing) {
      return {
        app: await this.lifecycle.get({ userId, appId: this.source.recommendedAppId }),
        installedNow: false,
      };
    }

    const catalog = await this.requireOfficialCatalog(signal);
    const entry = catalog.packages
      .filter(
        (candidate) =>
          candidate.appId === this.source.recommendedAppId && candidate.publisherKeyId === this.source.publisherKeyId,
      )
      .sort((left, right) => rcompare(left.version, right.version))[0];
    if (!entry) throw new Error('OFFICIAL_RECOMMENDED_PLUGIN_UNAVAILABLE');

    await this.plugins.trustPublisherKey(userId, this.source.publisherPublicKeyPem, this.source.publisherLabel);
    const stage = await this.plugins.stageOfficial(userId, this.source, entry.appId, entry.version, signal);
    const verified = await this.plugins.verify(userId, stage.id);
    if (
      verified.plugin.appId !== this.source.recommendedAppId ||
      verified.plugin.publisherKeyId !== this.source.publisherKeyId
    ) {
      throw new Error('OFFICIAL_RECOMMENDED_PLUGIN_IDENTITY_MISMATCH');
    }
    const installed = await this.plugins.install(userId, stage.id);
    const scope = { userId, appId: installed.app.appId };
    await this.grants.replace(
      scope,
      installed.app.policyRevision,
      installed.plugin.manifest.capabilities.map((capability) => ({
        capability,
        schemaVersion: 1,
        scope: { targetSelection: 'all-except-denylist' },
        grantedAt: Math.floor(Date.now() / 1000),
      })),
    );
    const afterGrants = await this.lifecycle.get(scope);
    const app = await this.lifecycle.setEnabled(scope, true, afterGrants.version);
    return { app, installedNow: true };
  }

  private async requireOfficialCatalog(signal?: AbortSignal) {
    const catalog = await this.plugins.officialCatalog(this.source, signal);
    const publisher = catalog.publishers.find((candidate) => candidate.keyId === this.source.publisherKeyId);
    if (!publisher || publisher.publicKeyPem.trim() !== this.source.publisherPublicKeyPem.trim()) {
      throw new Error('OFFICIAL_PLUGIN_PUBLISHER_MISMATCH');
    }
    return catalog;
  }
}
