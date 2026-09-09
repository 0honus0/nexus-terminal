export const formatStatusPercent = (value?: number): string | null => {
  if (value === undefined || !Number.isFinite(value)) return null;
  const bounded = Math.min(100, Math.max(0, value));
  return `${Number.isInteger(bounded) ? bounded.toFixed(0) : bounded.toFixed(1)}%`;
};

export const formatStatusMemoryPair = (usedMiB?: number, totalMiB?: number): string | null => {
  if (usedMiB === undefined || totalMiB === undefined || !Number.isFinite(usedMiB) || !Number.isFinite(totalMiB)) {
    return null;
  }
  if (totalMiB >= 1024) return `${(usedMiB / 1024).toFixed(1)} / ${(totalMiB / 1024).toFixed(1)} GB`;
  return `${Math.round(usedMiB)} / ${Math.round(totalMiB)} MB`;
};

export const formatStatusSwapPair = (usedMiB?: number, totalMiB?: number): string | null => {
  if (usedMiB === undefined || totalMiB === undefined || !Number.isFinite(usedMiB) || !Number.isFinite(totalMiB)) {
    return null;
  }
  if (totalMiB <= 0) return '0 / 0 GB';
  return formatStatusMemoryPair(usedMiB, totalMiB);
};

export const formatStatusDiskPair = (usedKiB?: number, totalKiB?: number): string | null => {
  if (usedKiB === undefined || totalKiB === undefined || !Number.isFinite(usedKiB) || !Number.isFinite(totalKiB)) {
    return null;
  }
  return `${(usedKiB / 1024 / 1024).toFixed(1)} / ${(totalKiB / 1024 / 1024).toFixed(1)} GB`;
};

export const formatStatusRate = (bytesPerSecond?: number): string => {
  if (bytesPerSecond === undefined || !Number.isFinite(bytesPerSecond)) return '0 B/s';
  const value = Math.max(0, bytesPerSecond);
  if (value < 1024) return `${Math.round(value)} B/s`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB/s`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB/s`;
  return `${(value / 1024 ** 3).toFixed(1)} GB/s`;
};

export const formatStatusRateAxis = (bytesPerSecond: number): string => {
  const value = Math.max(0, Number.isFinite(bytesPerSecond) ? bytesPerSecond : 0);
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(value >= 10 * 1024 ** 2 ? 0 : 1)}M`;
  if (value >= 1024) return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)}K`;
  return `${Math.round(value)}`;
};
