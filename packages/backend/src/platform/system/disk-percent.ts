export function diskUsedPercent(used: number, total: number): number | undefined {
	if (!Number.isFinite(used) || !Number.isFinite(total) || used < 0 || total <= 0) {
		return undefined;
	}
	return Math.min(100, Math.max(0, (used / total) * 100));
}
