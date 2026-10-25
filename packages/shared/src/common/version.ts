import { parse } from 'semver';

/** Canonical SemVer within the numeric range the comparator can order without precision loss. */
export function readComparableVersion(value: string): string | null {
	const parsed = parse(value);
	if (
		!parsed ||
		parsed.prerelease.some(
			(part) => typeof part === 'string' && /^[0-9]+$/u.test(part) && !Number.isSafeInteger(Number(part)),
		)
	) {
		return null;
	}
	return parsed.version;
}
