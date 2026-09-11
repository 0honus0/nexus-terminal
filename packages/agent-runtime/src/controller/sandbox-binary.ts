import { spawnSync } from 'node:child_process';
import semver from 'semver';

export const BUBBLEWRAP_RELEASE_VERSION = '0.12.0';
export const BUBBLEWRAP_MINIMUM_VERSION = '0.12.0';
export const DEFAULT_BUBBLEWRAP_BINARY = `/usr/local/lib/nexus-agent-runner/bubblewrap/${BUBBLEWRAP_RELEASE_VERSION}/bin/bwrap`;

export interface SandboxBinaryProbe {
  available: boolean;
  reason: 'sandbox_binary_unavailable' | 'sandbox_binary_version_invalid' | 'sandbox_binary_version_unsupported' | null;
  version: string | null;
}

export const sandboxBinaryPath = (): string => process.env.NEXUS_AGENT_SANDBOX_BIN?.trim() || DEFAULT_BUBBLEWRAP_BINARY;

export const probeSandboxBinary = (binary: string): SandboxBinaryProbe => {
  const result = spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 2_000,
  });
  if (result.error || result.status !== 0) {
    return { available: false, reason: 'sandbox_binary_unavailable', version: null };
  }
  const match = String(result.stdout ?? '')
    .trim()
    .match(/^bubblewrap\s+(\d+\.\d+\.\d+)$/);
  const version = match?.[1] ?? null;
  if (!version || !semver.valid(version)) {
    return { available: false, reason: 'sandbox_binary_version_invalid', version };
  }
  if (semver.lt(version, BUBBLEWRAP_MINIMUM_VERSION)) {
    return { available: false, reason: 'sandbox_binary_version_unsupported', version };
  }
  return { available: true, reason: null, version };
};

export const requireSupportedSandboxBinary = (binary: string): void => {
  const probe = probeSandboxBinary(binary);
  if (probe.available) return;
  if (probe.reason === 'sandbox_binary_version_unsupported') {
    throw new Error(`WORKSPACE_SANDBOX_VERSION_UNSUPPORTED:${probe.version ?? 'unknown'}`);
  }
  if (probe.reason === 'sandbox_binary_version_invalid') {
    throw new Error('WORKSPACE_SANDBOX_VERSION_INVALID');
  }
  throw new Error('WORKSPACE_SANDBOX_BINARY_UNAVAILABLE');
};
