import type { ModelCapabilityDefaults, ReasoningEffort } from './model.types';

interface RegistryEntry {
  id: string;
  defaults: ModelCapabilityDefaults;
}

interface ScoredRegistryEntry extends RegistryEntry {
  score: number;
  idMatchLength: number;
  familyBase: boolean;
  familyVersionRank: number;
}

export interface ModelCapabilityRegistryIndex {
  exact: ReadonlyMap<string, readonly RegistryEntry[]>;
  normalized: ReadonlyMap<string, readonly RegistryEntry[]>;
  family: ReadonlyMap<string, readonly RegistryEntry[]>;
}

export interface ModelCapabilityRegistryMatch {
  matchedId: string;
  canonicalId: string;
  requestedCanonicalId: string;
  reasoningEffort?: ReasoningEffort;
  defaults: ModelCapabilityDefaults;
}

const MODEL_KEY_CHARACTER = /[\p{L}\p{N}]/u;

export const normalizeModelCapabilityRegistryKey = (value: string): string => {
  let normalized = '';
  for (const character of value) {
    if (MODEL_KEY_CHARACTER.test(character)) normalized += character.toLowerCase();
  }
  return normalized;
};

const isNumericModelVersion = (value: string): boolean => /^\d+$/.test(value);

const REASONING_VARIANTS = new Set<ReasoningEffort>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

const validMonthDay = (month: number, day: number): boolean => {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1]!;
};

const modelDateSuffix = (value: string): { base: string; rank: number } | null => {
  const dashed = value.match(/^(.*)-(\d{4})-(\d{2})-(\d{2})$/);
  if (dashed) {
    const year = Number(dashed[2]);
    const month = Number(dashed[3]);
    const day = Number(dashed[4]);
    if (year >= 2000 && year <= 2199 && validMonthDay(month, day)) {
      return { base: dashed[1]!, rank: year * 10_000 + month * 100 + day };
    }
  }

  const compact = value.match(/^(.*)[-_](\d{8})$/);
  if (compact) {
    const date = compact[2]!;
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(4, 6));
    const day = Number(date.slice(6, 8));
    if (year >= 2000 && year <= 2199 && validMonthDay(month, day)) {
      return { base: compact[1]!, rank: year * 10_000 + month * 100 + day };
    }
  }

  const monthDay = value.match(/^(.*)[-_](\d{4})$/);
  if (monthDay) {
    const date = monthDay[2]!;
    const month = Number(date.slice(0, 2));
    const day = Number(date.slice(2, 4));
    if (validMonthDay(month, day)) return { base: monthDay[1]!, rank: month * 100 + day };
  }

  return null;
};

const splitReasoningVariant = (value: string): { base: string; reasoningEffort?: ReasoningEffort } => {
  const separator = value.lastIndexOf('-');
  if (separator < 0) return { base: value };
  const suffix = value.slice(separator + 1).toLowerCase() as ReasoningEffort;
  if (!REASONING_VARIANTS.has(suffix)) return { base: value };
  return { base: value.slice(0, separator), reasoningEffort: suffix };
};

const modelFamilyIdentity = (
  value: string,
): { base: string; versionRank: number; reasoningEffort?: ReasoningEffort } => {
  const dateSuffix = modelDateSuffix(value);
  const versionRank = dateSuffix?.rank ?? 0;
  const reasoning = splitReasoningVariant(dateSuffix?.base ?? value);
  return {
    base: reasoning.base,
    versionRank,
    ...(reasoning.reasoningEffort ? { reasoningEffort: reasoning.reasoningEffort } : {}),
  };
};

export const stripModelCapabilityRegistryPrefix = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  for (let index = 0; index + 3 <= trimmed.length; index += 1) {
    if (
      (index === 0 || trimmed[index - 1] === '/' || trimmed[index - 1] === ':') &&
      trimmed.slice(index, index + 3).toLowerCase() === 'ft:'
    ) {
      return trimmed.slice(index);
    }
  }

  for (let end = trimmed.length; end > 0;) {
    const slash = trimmed.lastIndexOf('/', end - 1);
    const colon = trimmed.lastIndexOf(':', end - 1);
    const index = Math.max(slash, colon);
    if (index < 0 || index === trimmed.length - 1) return trimmed;
    if (trimmed[index] === ':' && isNumericModelVersion(trimmed.slice(index + 1, end))) {
      end = index;
      continue;
    }
    return trimmed.slice(index + 1).trim();
  }
  return trimmed;
};

const register = (target: Map<string, RegistryEntry[]>, key: string, entry: RegistryEntry): void => {
  if (!key) return;
  const values = target.get(key);
  if (values) {
    if (!values.some((candidate) => candidate.id === entry.id)) values.push(entry);
    return;
  }
  target.set(key, [entry]);
};

export const createModelCapabilityRegistryIndex = (
  entries: Readonly<Record<string, ModelCapabilityDefaults>>,
): ModelCapabilityRegistryIndex => {
  const exact = new Map<string, RegistryEntry[]>();
  const normalized = new Map<string, RegistryEntry[]>();
  const family = new Map<string, RegistryEntry[]>();

  for (const [rawId, defaults] of Object.entries(entries)) {
    const id = rawId.trim();
    if (!id) continue;
    const entry = { id, defaults };
    const values = new Set([id, stripModelCapabilityRegistryPrefix(id)]);
    for (const value of values) {
      const exactKey = value.trim().toLowerCase();
      register(exact, exactKey, entry);
      register(normalized, normalizeModelCapabilityRegistryKey(value), entry);
      register(family, normalizeModelCapabilityRegistryKey(modelFamilyIdentity(value).base), entry);
    }
  }

  return { exact, normalized, family };
};

const modelIdMatchLength = (model: string, id: string): number => {
  const normalizedModel = model.trim().toLowerCase();
  const normalizedId = id.trim().toLowerCase();
  if (!normalizedId) return 0;
  if (
    normalizedModel === normalizedId ||
    normalizedModel.endsWith(`/${normalizedId}`) ||
    normalizedModel.endsWith(`:${normalizedId}`) ||
    normalizeModelCapabilityRegistryKey(stripModelCapabilityRegistryPrefix(normalizedModel)) ===
      normalizeModelCapabilityRegistryKey(normalizedId)
  ) {
    return normalizedId.length;
  }
  return 0;
};

const namespaceCount = (id: string): number => [...id].filter((character) => character === '/').length;

const candidateLess = (left: ScoredRegistryEntry, right: ScoredRegistryEntry): number => {
  if (left.score !== right.score) return right.score - left.score;
  if (left.familyBase !== right.familyBase) return left.familyBase ? -1 : 1;
  if (left.familyVersionRank !== right.familyVersionRank) return right.familyVersionRank - left.familyVersionRank;
  if (left.idMatchLength !== right.idMatchLength) return right.idMatchLength - left.idMatchLength;
  const leftNamespaces = namespaceCount(left.id);
  const rightNamespaces = namespaceCount(right.id);
  if (leftNamespaces !== rightNamespaces) return leftNamespaces - rightNamespaces;
  return left.id.localeCompare(right.id);
};

const sortedUniqueCandidates = (candidates: ScoredRegistryEntry[]): ScoredRegistryEntry[] => {
  const bestById = new Map<string, ScoredRegistryEntry>();
  for (const candidate of candidates) {
    const key = candidate.id.toLowerCase();
    const existing = bestById.get(key);
    if (!existing || candidateLess(candidate, existing) < 0) bestById.set(key, candidate);
  }
  return [...bestById.values()].sort(candidateLess);
};

export const matchModelCapabilityRegistry = (
  modelId: string,
  index: ModelCapabilityRegistryIndex,
): ModelCapabilityRegistryMatch | null => {
  const model = modelId.trim();
  if (!model) return null;

  const candidates: ScoredRegistryEntry[] = [];
  const add = (entries: readonly RegistryEntry[] | undefined, score: number): void => {
    if (!entries) return;
    for (const entry of entries) {
      const entryIdentity = modelFamilyIdentity(stripModelCapabilityRegistryPrefix(entry.id));
      candidates.push({
        ...entry,
        score,
        idMatchLength: modelIdMatchLength(model, entry.id),
        familyBase: entryIdentity.base === stripModelCapabilityRegistryPrefix(entry.id),
        familyVersionRank: entryIdentity.versionRank,
      });
    }
  };

  const suffix = stripModelCapabilityRegistryPrefix(model);
  const requestedIdentity = modelFamilyIdentity(suffix);
  const suffixFamily = requestedIdentity.base;
  if (suffix !== model) {
    add(index.exact.get(suffix.toLowerCase()), 120);
    add(index.normalized.get(normalizeModelCapabilityRegistryKey(suffix)), 116);
    add(index.exact.get(model.toLowerCase()), 112);
    add(index.normalized.get(normalizeModelCapabilityRegistryKey(model)), 108);
    add(index.family.get(normalizeModelCapabilityRegistryKey(suffixFamily)), 100);
    add(index.family.get(normalizeModelCapabilityRegistryKey(modelFamilyIdentity(model).base)), 96);
  } else {
    add(index.exact.get(model.toLowerCase()), 120);
    add(index.normalized.get(normalizeModelCapabilityRegistryKey(model)), 116);
    add(index.family.get(normalizeModelCapabilityRegistryKey(suffixFamily)), 100);
  }

  const match = sortedUniqueCandidates(candidates)[0];
  if (!match) return null;
  return {
    matchedId: match.id,
    canonicalId: stripModelCapabilityRegistryPrefix(match.id),
    requestedCanonicalId: suffix,
    ...(requestedIdentity.reasoningEffort ? { reasoningEffort: requestedIdentity.reasoningEffort } : {}),
    defaults: match.defaults,
  };
};
