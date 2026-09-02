const RELEASE_REPOSITORY = '0honus0/nexus-terminal';

export const releaseRepository = RELEASE_REPOSITORY;
export const releaseRepositoryUrl = `https://github.com/${RELEASE_REPOSITORY}`;
export const latestReleaseApiUrl = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;

export const getReleaseUrl = (tag: string) => `${releaseRepositoryUrl}/releases/tag/${encodeURIComponent(tag)}`;

const parseVersion = (version: string) => {
  const normalized = version.trim().replace(/^v/i, '').split('+', 1)[0];
  const [core, prerelease = ''] = normalized.split('-', 2);
  const coreParts = core.split('.');

  if (coreParts.length === 0 || coreParts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }

  return {
    core: coreParts.map(Number),
    prerelease: prerelease ? prerelease.split('.') : [],
  };
};

export const isNewerRelease = (latest: string, current: string) => {
  const latestVersion = parseVersion(latest);
  const currentVersion = parseVersion(current);

  if (!latestVersion || !currentVersion) {
    return latest.trim() !== current.trim();
  }

  const coreLength = Math.max(latestVersion.core.length, currentVersion.core.length);
  for (let index = 0; index < coreLength; index += 1) {
    const latestPart = latestVersion.core[index] ?? 0;
    const currentPart = currentVersion.core[index] ?? 0;
    if (latestPart !== currentPart) {
      return latestPart > currentPart;
    }
  }

  if (latestVersion.prerelease.length === 0 || currentVersion.prerelease.length === 0) {
    return latestVersion.prerelease.length === 0 && currentVersion.prerelease.length > 0;
  }

  const prereleaseLength = Math.max(latestVersion.prerelease.length, currentVersion.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const latestPart = latestVersion.prerelease[index];
    const currentPart = currentVersion.prerelease[index];

    if (latestPart === undefined || currentPart === undefined) {
      return currentPart === undefined;
    }
    if (latestPart === currentPart) continue;

    const latestIsNumeric = /^\d+$/.test(latestPart);
    const currentIsNumeric = /^\d+$/.test(currentPart);
    if (latestIsNumeric && currentIsNumeric) {
      return Number(latestPart) > Number(currentPart);
    }
    if (latestIsNumeric !== currentIsNumeric) {
      return !latestIsNumeric;
    }
    return latestPart > currentPart;
  }

  return false;
};
