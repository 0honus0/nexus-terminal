import { createHash } from 'node:crypto';
import path from 'node:path';

/** Canonical POSIX path used by remote filesystem operations and resource-key construction. */
export const normalizeAbsoluteRemotePath = (value: string, label = 'Remote path'): string => {
  if (value.includes('\0')) throw new Error(`${label} must not contain a null byte.`);
  // SSH/SFTP paths are POSIX paths. Backslash is a legal filename character, not a separator,
  // so it must survive normalization exactly as supplied by the remote filesystem.
  const normalized = path.posix.normalize(value);
  if (!path.posix.isAbsolute(normalized)) throw new Error(`${label} must be absolute: ${value}`);
  return normalized;
};

/**
 * Lease/resource identifiers are infrastructure metadata, not remote filenames. Hash the exact
 * canonical path so every legal POSIX filename maps to a bounded validation-safe identity without
 * changing the path sent to SSH/SFTP.
 */
export const remoteFileResourceKey = (scopeKey: string, remotePath: string): string =>
  scopeKey + ':file:sha256:' + createHash('sha256').update(remotePath, 'utf8').digest('hex');
