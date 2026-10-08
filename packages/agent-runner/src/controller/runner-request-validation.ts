import type { WorkspaceBrowserEndpoint, WorkspaceProvisionCommand } from '@nexus-terminal/protocol/runner';

export const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED');
  return value as Record<string, unknown>;
};

export const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
};

const SAFE_RUNTIME_RESOURCE_ID = /^[a-z][a-z0-9_.-]{0,127}$/;
const validBrowserUrlPattern = (value: string): boolean => {
  const match = /^(\*|https?|wss?):\/\/(\*\.)?([^/:?#]+)(?::(\d{1,5}))?(\/[^?#]*)?$/.exec(value.trim());
  if (!match) return false;
  const port = match[4];
  if (port && (Number(port) < 1 || Number(port) > 65535)) return false;
  const rawPath = match[5];
  return !rawPath || !rawPath.includes('*') || rawPath.endsWith('*');
};

export const decodeBrowserEndpoint = (value: unknown): WorkspaceBrowserEndpoint => {
  const record = asRecord(value);
  if (
    (record.scope !== 'docker-network' && record.scope !== 'external-network') ||
    record.via !== 'runner' ||
    typeof record.url !== 'string' ||
    !record.url ||
    record.url.length > 4096 ||
    !Number.isSafeInteger(record.priority) ||
    Number(record.priority) < 0 ||
    Number(record.priority) > 10000 ||
    typeof record.allowPlaintext !== 'boolean' ||
    typeof record.verifyTls !== 'boolean'
  ) {
    throw new Error('BROWSER_ENDPOINT_INVALID');
  }
  let url: URL;
  try {
    url = new URL(record.url);
  } catch {
    throw new Error('BROWSER_ENDPOINT_INVALID');
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) throw new Error('BROWSER_ENDPOINT_INVALID');
  return {
    scope: record.scope,
    via: 'runner',
    url: record.url,
    priority: Number(record.priority),
    allowPlaintext: record.allowPlaintext,
    verifyTls: record.verifyTls,
  };
};

export const validateWorkspaceBindings = (command: WorkspaceProvisionCommand): void => {
  const target = command.browserTarget;
  if (target === null) return;
  if (
    !target ||
    !SAFE_RUNTIME_RESOURCE_ID.test(target.id) ||
    !Number.isSafeInteger(target.profileRevision) ||
    target.profileRevision < 1 ||
    !Array.isArray(target.endpoints) ||
    target.endpoints.length < 1 ||
    target.endpoints.length > 16 ||
    !Array.isArray(target.allowedUrlPatterns) ||
    target.allowedUrlPatterns.length < 1 ||
    target.allowedUrlPatterns.length > 128
  ) {
    throw new Error('BROWSER_TARGET_INVALID');
  }
  const patterns = new Set<string>();
  for (const pattern of target.allowedUrlPatterns) {
    if (
      typeof pattern !== 'string' ||
      pattern.length > 2048 ||
      patterns.has(pattern) ||
      !validBrowserUrlPattern(pattern)
    ) {
      throw new Error('BROWSER_TARGET_INVALID');
    }
    patterns.add(pattern);
  }
  for (const endpoint of target.endpoints) {
    if (
      !endpoint ||
      (endpoint.scope !== 'docker-network' && endpoint.scope !== 'external-network') ||
      (endpoint.via !== 'backend' && endpoint.via !== 'runner') ||
      typeof endpoint.url !== 'string' ||
      !endpoint.url ||
      endpoint.url.length > 4096 ||
      !Number.isSafeInteger(endpoint.priority) ||
      endpoint.priority < 0 ||
      endpoint.priority > 10000 ||
      typeof endpoint.allowPlaintext !== 'boolean' ||
      typeof endpoint.verifyTls !== 'boolean'
    ) {
      throw new Error('BROWSER_ENDPOINT_INVALID');
    }
    let url: URL;
    try {
      url = new URL(endpoint.url);
    } catch {
      throw new Error('BROWSER_ENDPOINT_INVALID');
    }
    if (
      !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      ((url.protocol === 'http:' || url.protocol === 'ws:') && !endpoint.allowPlaintext)
    ) {
      throw new Error('BROWSER_ENDPOINT_INVALID');
    }
  }
};
