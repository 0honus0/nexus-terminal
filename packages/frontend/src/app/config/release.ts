import { gt } from 'semver';
import { readComparableVersion } from '@nexus-terminal/shared/common/version';

const RELEASE_REPOSITORY = '0honus0/nexus-terminal';

export const releaseRepository = RELEASE_REPOSITORY;

export const releaseRepositoryUrl = `https://github.com/${RELEASE_REPOSITORY}`;

export const latestReleaseApiUrl = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;

export const releaseUrl = (tag: string) => `${releaseRepositoryUrl}/releases/tag/${encodeURIComponent(tag)}`;

/** Release tags permit a leading v; malformed tags never trigger an update. */
export const isNewerRelease = (latest: string, current: string): boolean => {
	const left = readComparableVersion(latest.trim().replace(/^v/i, ''));
	const right = readComparableVersion(current.trim().replace(/^v/i, ''));
	return left !== null && right !== null && gt(left, right);
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
