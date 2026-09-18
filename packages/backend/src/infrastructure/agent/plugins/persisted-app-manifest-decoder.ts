import { valid } from 'semver';
import { normalizeRequiredModelCapabilities } from '../../../modules/agent/ai/model-capability-requirements';
import {
  AGENT_CAPABILITIES,
  type AgentAppAgentDefinition,
  type AgentAppManifest,
  type AgentAppTargets,
  type AgentCapability,
} from '../../../modules/agent/host/app.types';
import {
  decodeDurableStringArray,
  durableInteger,
  durableRecord,
  durableString,
  parseDurableJson,
} from '../runtime/durable-state-decoders';

const APP_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;
const INTENT_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const allowedCapabilities = new Set<string>(AGENT_CAPABILITIES);

const invalid = (): never => {
  throw new Error('PLUGIN_MANIFEST_INVALID');
};

const nonEmptyString = (value: unknown): string => {
  const result = durableString(value) as string;
  if (!result.trim()) return invalid();
  return result;
};

const semver = (value: unknown): string => {
  const result = nonEmptyString(value);
  if (!valid(result)) return invalid();
  return result;
};

const safeEntry = (value: unknown): string => {
  const result = nonEmptyString(value);
  if (
    result.includes('\0') ||
    result.includes('\\') ||
    result.startsWith('/') ||
    /^[A-Za-z]:/.test(result) ||
    result.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    return invalid();
  }
  return result;
};

const decodeTargets = (value: unknown): AgentAppTargets => {
  const record = durableRecord(value);
  const result: AgentAppTargets = {};
  for (const key of ['frontend', 'backend', 'runner'] as const) {
    if (record[key] === undefined) continue;
    const target = durableRecord(record[key]);
    result[key] = { entry: safeEntry(target.entry) };
  }
  return result;
};

const decodeAgents = (value: unknown): AgentAppAgentDefinition[] => {
  if (!Array.isArray(value) || value.length > 32) return invalid();
  const seen = new Set<string>();
  return value.map((item) => {
    const record = durableRecord(item);
    const id = nonEmptyString(record.id);
    if (!INTENT_ID.test(id) || seen.has(id)) return invalid();
    seen.add(id);
    const rawRequiredModelCapabilities = decodeDurableStringArray(record.requiredModelCapabilities, 32);
    if (new Set(rawRequiredModelCapabilities).size !== rawRequiredModelCapabilities.length) return invalid();
    const requiredModelCapabilities = normalizeRequiredModelCapabilities(rawRequiredModelCapabilities);
    if (!requiredModelCapabilities) return invalid();
    return {
      id,
      version: semver(record.version),
      displayName: nonEmptyString(record.displayName),
      description: nonEmptyString(record.description),
      requiredModelCapabilities,
    };
  });
};

export const decodePersistedAppManifest = (raw: string): AgentAppManifest => {
  try {
    const record = durableRecord(parseDurableJson(raw));
    if (record.schemaVersion !== 1) return invalid();
    const id = nonEmptyString(record.id);
    if (!APP_ID.test(id)) return invalid();
    const nexus = durableRecord(record.nexus);
    const minVersion = semver(nexus.minVersion);
    const maxVersion = semver(nexus.maxVersion);
    if (!Array.isArray(record.capabilities) || record.capabilities.length > AGENT_CAPABILITIES.length) return invalid();
    const capabilities = record.capabilities.map((item) => {
      if (typeof item !== 'string' || !allowedCapabilities.has(item)) return invalid();
      return item as AgentCapability;
    });
    if (new Set(capabilities).size !== capabilities.length) return invalid();
    if (!Array.isArray(record.intents) || record.intents.length > 256) return invalid();
    const intentIds = new Set<string>();
    const intents = record.intents.map((item) => {
      const intent = durableRecord(item);
      const intentId = nonEmptyString(intent.id);
      if (!INTENT_ID.test(intentId) || intentIds.has(intentId)) return invalid();
      intentIds.add(intentId);
      return { id: intentId, schemaVersion: durableInteger(intent.schemaVersion, 1) };
    });
    const agentSurface = record.agentSurface === undefined
      ? undefined
      : (() => {
          const surface = durableRecord(record.agentSurface);
          if (surface.defaultApprovalMode !== undefined && !['ask', 'full_access'].includes(String(surface.defaultApprovalMode))) {
            return invalid();
          }
          return surface.defaultApprovalMode === undefined
            ? {}
            : { defaultApprovalMode: surface.defaultApprovalMode as 'ask' | 'full_access' };
        })();
    return {
      schemaVersion: 1,
      id,
      version: semver(record.version),
      displayName: nonEmptyString(record.displayName),
      sdkVersion: semver(record.sdkVersion),
      nexus: { minVersion, maxVersion },
      capabilities,
      intents,
      ...(record.agents === undefined ? {} : { agents: decodeAgents(record.agents) }),
      ...(agentSurface === undefined ? {} : { agentSurface }),
      ...(record.targets === undefined ? {} : { targets: decodeTargets(record.targets) }),
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'PLUGIN_MANIFEST_INVALID') throw error;
    throw new Error('PLUGIN_MANIFEST_INVALID');
  }
};
