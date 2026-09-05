const RELEASE_REPOSITORY = '0honus0/nexus-terminal';

export const releaseRepository = RELEASE_REPOSITORY;
export const releaseRepositoryUrl = `https://github.com/${RELEASE_REPOSITORY}`;
export const latestReleaseApiUrl = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
export const releaseUrl = (tag: string) => `${releaseRepositoryUrl}/releases/tag/${encodeURIComponent(tag)}`;

interface ParsedVersion {
  core: number[];
  prerelease: string[];
}

const parseVersion = (version: string): ParsedVersion | null => {
  const normalized = version.trim().replace(/^v/i, '').split('+', 1)[0] ?? '';
  const [core = '', prerelease = ''] = normalized.split('-', 2);
  const coreParts = core.split('.');
  if (!coreParts.length || coreParts.some((part) => !/^\d+$/.test(part))) return null;
  return { core: coreParts.map(Number), prerelease: prerelease ? prerelease.split('.') : [] };
};

export const isNewerRelease = (latest: string, current: string): boolean => {
  const left = parseVersion(latest);
  const right = parseVersion(current);
  if (!left || !right) return latest.trim() !== current.trim();

  const coreLength = Math.max(left.core.length, right.core.length);
  for (let index = 0; index < coreLength; index += 1) {
    const latestPart = left.core[index] ?? 0;
    const currentPart = right.core[index] ?? 0;
    if (latestPart !== currentPart) return latestPart > currentPart;
  }

  if (!left.prerelease.length || !right.prerelease.length) {
    return !left.prerelease.length && Boolean(right.prerelease.length);
  }

  const prereleaseLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const latestPart = left.prerelease[index];
    const currentPart = right.prerelease[index];
    if (latestPart === undefined || currentPart === undefined) return currentPart !== undefined;
    if (latestPart === currentPart) continue;

    const latestNumeric = /^\d+$/.test(latestPart);
    const currentNumeric = /^\d+$/.test(currentPart);
    if (latestNumeric && currentNumeric) return Number(latestPart) > Number(currentPart);
    if (latestNumeric !== currentNumeric) return !latestNumeric;
    return latestPart > currentPart;
  }
  return false;
};

export async function fetchLatestRelease(signal?: AbortSignal): Promise<string> {
  const response = await fetch(latestReleaseApiUrl, {
    headers: { Accept: 'application/vnd.github+json' },
    signal,
  });
  if (!response.ok) {
    const error = new Error(`GitHub release request failed (${response.status}).`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  const data = (await response.json()) as { tag_name?: unknown };
  if (typeof data.tag_name !== 'string' || !data.tag_name.trim()) throw new Error('Invalid GitHub release response.');
  return data.tag_name;
}
