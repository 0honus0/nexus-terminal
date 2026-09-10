import path from 'node:path';

/** Canonical POSIX path used by remote filesystem operations and resource-key construction. */
export const normalizeAbsoluteRemotePath = (value: string, label = 'Remote path'): string => {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (!path.posix.isAbsolute(normalized)) throw new Error(`${label} must be absolute: ${value}`);
  return normalized;
};
