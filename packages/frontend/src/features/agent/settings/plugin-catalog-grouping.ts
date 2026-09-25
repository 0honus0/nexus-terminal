import type { AgentRemotePluginCatalogDto, AgentRemotePluginPackageDto } from '../api/agent-api';

export interface PluginCatalogSource {
  catalog: AgentRemotePluginCatalogDto;
  official: boolean;
}

export interface PluginSourcePackageItem {
  package: AgentRemotePluginPackageDto;
  catalog: AgentRemotePluginCatalogDto;
  official: boolean;
}

export interface PluginSourceGroup {
  key: string;
  owner: string;
  sourceUrl: string;
  official: boolean;
  packages: PluginSourcePackageItem[];
}

export const canonicalPluginRepositoryUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
};

export const pluginRepositorySourceLabel = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    const owner = parts[0] && parts[0] !== 'catalog.json' ? parts[0] : '';
    return owner ? `${host}/${owner}` : host;
  } catch {
    return rawUrl;
  }
};

export const groupPluginCatalogSources = (sources: readonly PluginCatalogSource[]): PluginSourceGroup[] => {
  const groups: PluginSourceGroup[] = [];
  const groupMap = new Map<string, PluginSourceGroup>();

  for (const source of sources) {
    const sourceUrl = canonicalPluginRepositoryUrl(source.catalog.repositoryUrl);
    const key = `${source.official ? 'official' : 'remote'}\u0000${sourceUrl}`;
    let group = groupMap.get(key);
    if (!group) {
      group = {
        key,
        owner: pluginRepositorySourceLabel(sourceUrl),
        sourceUrl,
        official: source.official,
        packages: [],
      };
      groupMap.set(key, group);
      groups.push(group);
    }

    for (const entry of source.catalog.packages) {
      group.packages.push({
        package: entry,
        catalog: source.catalog,
        official: source.official,
      });
    }
  }

  return groups;
};
