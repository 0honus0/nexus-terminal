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
    const installation = (await this.plugins.listInstallations(userId)).find(
      (candidate) => candidate.appId === this.source.recommendedAppId && candidate.status === 'installed',
    );
    if (installation) {
      const [app, versions] = await Promise.all([
        this.lifecycle.get({ userId, appId: this.source.recommendedAppId }),
        this.plugins.listVersions(userId, this.source.recommendedAppId),
      ]);
      const installed = versions.find(
        (candidate) => candidate.version === installation.version && candidate.status === 'installed',
      );
      if (!installed) throw new Error('PLUGIN_VERSION_NOT_FOUND');
      const description =
        installed.manifest.agents?.[0]?.description ?? `Installed Nexus plugin: ${installed.manifest.displayName}.`;
      return {
        appId: installed.appId,
        installed: true,
        installedVersion: installed.version,
        enabled: app.desiredState === 'enabled',
        availableVersion: installed.version,
        displayName: installed.manifest.displayName,
        description,
        catalogUrl: this.source.catalogUrl,
        publisherKeyId: installed.publisherKeyId,
      };
    }

    const catalog = await this.requireOfficialCatalog(signal);
    const entry = catalog.packages
      .filter(
        (candidate) =>
          candidate.appId === this.source.recommendedAppId &&
          candidate.publisherKeyId === this.source.publisherKeyId &&
          candidate.compatible === true,
      )
      .sort((left, right) => rcompare(left.version, right.version))[0];
    if (!entry) throw new Error('OFFICIAL_RECOMMENDED_PLUGIN_UNAVAILABLE');
    return {
      appId: entry.appId,
      installed: false,
      installedVersion: null,
      enabled: false,
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
      const scope = { userId, appId: this.source.recommendedAppId };
      const current = await this.lifecycle.get(scope);
      const app =
        current.desiredState === 'enabled' ? current : await this.lifecycle.setEnabled(scope, true, current.version);
      return { app, installedNow: false };
    }

    const catalog = await this.requireOfficialCatalog(signal);
    const entry = catalog.packages
      .filter(
        (candidate) =>
          candidate.appId === this.source.recommendedAppId &&
          candidate.publisherKeyId === this.source.publisherKeyId &&
          candidate.compatible === true,
      )
      .sort((left, right) => rcompare(left.version, right.version))[0];
    if (!entry) throw new Error('OFFICIAL_RECOMMENDED_PLUGIN_UNAVAILABLE');

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

  private requireOfficialCatalog(signal?: AbortSignal) {
    return this.plugins.officialCatalog(this.source, signal);
  }
}
