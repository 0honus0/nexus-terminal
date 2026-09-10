import { compare, major, valid } from 'semver';
import type { JsonValue } from '../agent.types';
import { assertJsonSchema } from '../json-schema-validator';
import {
  AGENT_CAPABILITIES,
  type AgentAppIntent,
  type AgentAppTarget,
  type AgentAppTargets,
  type AgentCapability,
  type ValidatedManifest,
} from './app.types';

const APP_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;
const INTENT_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const capabilitySet = new Set<string>(AGENT_CAPABILITIES);

const MANIFEST_SCHEMA: JsonValue = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'version', 'displayName', 'sdkVersion', 'nexus', 'capabilities', 'intents'],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: 'string', minLength: 1 },
    version: { type: 'string', minLength: 1 },
    displayName: { type: 'string', minLength: 1 },
    sdkVersion: { type: 'string', minLength: 1 },
    nexus: {
      type: 'object',
      additionalProperties: false,
      required: ['minVersion', 'maxVersion'],
      properties: {
        minVersion: { type: 'string', minLength: 1 },
        maxVersion: { type: 'string', minLength: 1 },
      },
    },
    capabilities: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
    intents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'schemaVersion'],
        properties: {
          id: { type: 'string', minLength: 1 },
          schemaVersion: { type: 'integer', minimum: 1 },
        },
      },
    },
    targets: {
      type: 'object',
      additionalProperties: false,
      properties: {
        frontend: {
          type: 'object',
          additionalProperties: false,
          required: ['entry'],
          properties: { entry: { type: 'string', minLength: 1 } },
        },
        backend: {
          type: 'object',
          additionalProperties: false,
          required: ['entry'],
          properties: { entry: { type: 'string', minLength: 1 } },
        },
        runner: {
          type: 'object',
          additionalProperties: false,
          required: ['entry'],
          properties: { entry: { type: 'string', minLength: 1 } },
        },
      },
    },
  },
};

interface ManifestValidatorOptions {
  nexusVersion: string;
  supportedSdkMajor?: number;
}

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
};

const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string.`);
  return value;
};

const integer = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} must be a positive integer.`);
  return value as number;
};

const requireSemver = (value: string, label: string): string => {
  const normalized = valid(value);
  if (!normalized) throw new Error(`${label} must be a valid semver value.`);
  return normalized;
};

const validateTargetEntryPath = (value: string, label: string): string => {
  if (value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`${label} must be a safe relative path.`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${label} must not contain empty, current-directory, or parent-directory segments.`);
  }
  return value;
};

export const validateManifest = (raw: unknown, options: ManifestValidatorOptions): ValidatedManifest => {
  assertJsonSchema(MANIFEST_SCHEMA, raw, 'AGENT_MANIFEST_SCHEMA_INVALID');
  const input = record(raw, 'manifest');
  if (input.schemaVersion !== 1) throw new Error('manifest.schemaVersion must be 1.');

  const id = string(input.id, 'manifest.id');
  if (!APP_ID.test(id)) throw new Error(`Invalid Agent App id: ${id}`);

  const version = string(input.version, 'manifest.version');
  const sdkVersion = string(input.sdkVersion, 'manifest.sdkVersion');
  const displayName = string(input.displayName, 'manifest.displayName');
  requireSemver(version, 'manifest.version');
  requireSemver(sdkVersion, 'manifest.sdkVersion');
  requireSemver(options.nexusVersion, 'Nexus version');

  if (options.supportedSdkMajor !== undefined && major(sdkVersion) !== options.supportedSdkMajor) {
    throw new Error(
      `Agent SDK major ${major(sdkVersion)} is incompatible with supported major ${options.supportedSdkMajor}.`,
    );
  }

  const nexus = record(input.nexus, 'manifest.nexus');
  const minVersion = string(nexus.minVersion, 'manifest.nexus.minVersion');
  const maxVersion = string(nexus.maxVersion, 'manifest.nexus.maxVersion');
  requireSemver(minVersion, 'manifest.nexus.minVersion');
  requireSemver(maxVersion, 'manifest.nexus.maxVersion');
  if (compare(minVersion, maxVersion) > 0) throw new Error('manifest.nexus minVersion must not exceed maxVersion.');
  if (compare(options.nexusVersion, minVersion) < 0 || compare(options.nexusVersion, maxVersion) > 0) {
    throw new Error(`Agent App ${id}@${version} does not support Nexus ${options.nexusVersion}.`);
  }

  if (!Array.isArray(input.capabilities)) throw new Error('manifest.capabilities must be an array.');
  const capabilities: AgentCapability[] = [];
  const seenCapabilities = new Set<string>();
  for (const candidate of input.capabilities) {
    const capability = string(candidate, 'manifest.capabilities[]');
    if (!capabilitySet.has(capability)) throw new Error(`Unknown Agent capability: ${capability}`);
    if (seenCapabilities.has(capability)) throw new Error(`Duplicate Agent capability: ${capability}`);
    seenCapabilities.add(capability);
    capabilities.push(capability as AgentCapability);
  }

  if (!Array.isArray(input.intents)) throw new Error('manifest.intents must be an array.');
  const intents: AgentAppIntent[] = [];
  const seenIntents = new Set<string>();
  for (const candidate of input.intents) {
    const intent = record(candidate, 'manifest.intents[]');
    const intentId = string(intent.id, 'manifest.intents[].id');
    if (!INTENT_ID.test(intentId)) throw new Error(`Invalid Agent intent id: ${intentId}`);
    if (seenIntents.has(intentId)) throw new Error(`Duplicate Agent intent id: ${intentId}`);
    seenIntents.add(intentId);
    intents.push({ id: intentId, schemaVersion: integer(intent.schemaVersion, 'manifest.intents[].schemaVersion') });
  }

  let targets: AgentAppTargets | undefined;
  if (input.targets !== undefined) {
    const rawTargets = record(input.targets, 'manifest.targets');
    targets = {};
    const validateTarget = (name: 'frontend' | 'backend' | 'runner', prefix: string): AgentAppTarget | undefined => {
      const rawTarget = rawTargets[name];
      if (rawTarget === undefined) return undefined;
      const target = record(rawTarget, `manifest.targets.${name}`);
      const entry = validateTargetEntryPath(
        string(target.entry, `manifest.targets.${name}.entry`),
        `manifest.targets.${name}.entry`,
      );
      if (!entry.startsWith(`${prefix}/`)) {
        throw new Error(`manifest.targets.${name}.entry must be inside ${prefix}/.`);
      }
      return { entry };
    };
    const frontend = validateTarget('frontend', 'frontend');
    const backend = validateTarget('backend', 'backend');
    const runner = validateTarget('runner', 'runner');
    if (frontend) targets.frontend = frontend;
    if (backend) targets.backend = backend;
    if (runner) targets.runner = runner;
  }

  return {
    schemaVersion: 1,
    id,
    version,
    displayName,
    sdkVersion,
    nexus: { minVersion, maxVersion },
    capabilities,
    intents,
    ...(targets ? { targets } : {}),
    validated: true,
  };
};
