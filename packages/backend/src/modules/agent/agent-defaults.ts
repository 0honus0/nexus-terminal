export interface AgentRunBudgetSnapshot {
  maxRunTokens: number;
  maxRunSteps: number;
  maxRunCostMicros: number | null;
  maxActiveExecutionSeconds: number;
}

export interface AgentAcpWorkspaceProfileSetting {
  id: string;
  argv: string[];
  cwd: string;
}

export interface AgentBrowserEndpointSetting {
  scope: 'docker-network' | 'external-network';
  via: 'backend' | 'runner';
  url: string;
  priority: number;
  allowPlaintext: boolean;
  verifyTls: boolean;
}

export interface AgentPluginRepositorySetting {
  url: string;
  privateHostExceptions: string[];
}

export interface AgentBrowserTargetSetting {
  id: string;
  endpoints: AgentBrowserEndpointSetting[];
  allowedUrlPatterns: string[];
}

export interface AgentSettingsDocument {
  schemaVersion: 1;
  feature: { enabled: boolean };
  model: {
    defaultProviderId: string | null;
    defaultModelId: string | null;
  };
  performance: {
    maxConcurrentRuntimes: number;
    maxConcurrentModelCalls: 'auto' | number;
  };
  budget: {
    maxContextTokens: number;
    maxOutputTokens: number;
    maxRunTokens: number;
    maxRunSteps: number;
    maxRunCostMicros: number | null;
    maxActiveExecutionSeconds: number;
    toolTimeoutSeconds: number;
    maxToolOutputBytes: number;
    maxRawToolBytes: number;
    maxRecallItems: number;
    maxRecallBytes: number;
  };
  hardLimits: {
    maxContextTokens: number;
    maxOutputTokens: number;
    maxRunTokens: number;
    maxRunSteps: number;
    maxRunCostMicros: number | null;
    maxActiveExecutionSeconds: number;
    toolTimeoutSeconds: number;
    maxToolOutputBytes: number;
    maxRawToolBytes: number;
    maxArtifactBytes: number;
    maxSingleArtifactBytes: number;
    maxGlobalArtifactBytes: number;
    maxRecallItems: number;
    maxRecallBytes: number;
    maxConcurrentRuntimes: number;
    maxConcurrentModelCalls: number;
    maxDelegationDepth: number;
    maxSubagentMessagesPerRun: number;
    maxSubagentMessageBytesPerRun: number;
    maxActiveWorkspaces: number;
    unretainedArtifactTtlSeconds: number;
    workspaceIdleTtlSeconds: number;
  };
  subagents: {
    maxDelegationDepth: number;
    maxSubagentMessagesPerRun: number;
    maxSubagentMessageBytesPerRun: number;
  };
  storage: {
    maxArtifactBytes: number;
    maxSingleArtifactBytes: number;
    maxGlobalArtifactBytes: number;
    unretainedArtifactTtlSeconds: number;
  };
  workspaceRuntime: {
    maxActiveWorkspaces: number;
    workspaceIdleTtlSeconds: number;
    enabledRecipeIds: string[];
    toolVersions: Record<string, { enabledVersionIds: string[]; defaultVersionId: string | null }>;
    acpProfiles: AgentAcpWorkspaceProfileSetting[];
  };
  browser: {
    targets: AgentBrowserTargetSetting[];
  };
  plugins: {
    repositories: AgentPluginRepositorySetting[];
  };
  safety: {
    providerPrivateNetworkExceptions: string[];
  };
}

export const AGENT_DEFAULTS = {
  approvalTtlSeconds: 600,
  leaseTtlSeconds: 30,
  leaseRenewSeconds: 10,
  minFreeDiskBytes: 1_073_741_824,
  modelRetryCount: 2,
  estimateMargin: 0.15,
  maxConcurrentToolCalls: 1,
  settings: {
    schemaVersion: 1,
    feature: { enabled: true },
    model: { defaultProviderId: null, defaultModelId: null },
    performance: { maxConcurrentRuntimes: 2, maxConcurrentModelCalls: 'auto' },
    budget: {
      maxContextTokens: 32_000,
      maxOutputTokens: 4_096,
      maxRunTokens: 100_000,
      maxRunSteps: 80,
      maxRunCostMicros: null,
      maxActiveExecutionSeconds: 1_800,
      toolTimeoutSeconds: 60,
      maxToolOutputBytes: 65_536,
      maxRawToolBytes: 10_485_760,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
    },
    hardLimits: {
      maxContextTokens: 128_000,
      maxOutputTokens: 16_384,
      maxRunTokens: 1_000_000,
      maxRunSteps: 400,
      maxRunCostMicros: null,
      maxActiveExecutionSeconds: 7_200,
      toolTimeoutSeconds: 300,
      maxToolOutputBytes: 262_144,
      maxRawToolBytes: 52_428_800,
      maxArtifactBytes: 1_073_741_824,
      maxSingleArtifactBytes: 268_435_456,
      maxGlobalArtifactBytes: 10_737_418_240,
      maxRecallItems: 20,
      maxRecallBytes: 32_768,
      maxConcurrentRuntimes: 4,
      maxConcurrentModelCalls: 4,
      maxDelegationDepth: 3,
      maxSubagentMessagesPerRun: 5_000,
      maxSubagentMessageBytesPerRun: 8_388_608,
      maxActiveWorkspaces: 8,
      unretainedArtifactTtlSeconds: 2_592_000,
      workspaceIdleTtlSeconds: 3_600,
    },
    subagents: {
      maxDelegationDepth: 2,
      maxSubagentMessagesPerRun: 1_000,
      maxSubagentMessageBytesPerRun: 2_097_152,
    },
    storage: {
      maxArtifactBytes: 268_435_456,
      maxSingleArtifactBytes: 52_428_800,
      maxGlobalArtifactBytes: 2_147_483_648,
      unretainedArtifactTtlSeconds: 604_800,
    },
    workspaceRuntime: {
      maxActiveWorkspaces: 4,
      workspaceIdleTtlSeconds: 900,
      enabledRecipeIds: [],
      toolVersions: {},
      acpProfiles: [],
    },
    browser: { targets: [] },
    plugins: { repositories: [] },
    safety: { providerPrivateNetworkExceptions: [] },
  } satisfies AgentSettingsDocument,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const integer = (value: unknown, fallback: number, minimum = 0): number =>
  Number.isSafeInteger(value) && (value as number) >= minimum ? (value as number) : fallback;

const nullableInteger = (value: unknown, fallback: number | null): number | null =>
  value === null ? null : integer(value, fallback ?? 0, 0);

const stringOrNull = (value: unknown, fallback: string | null): string | null =>
  value === null || typeof value === 'string' ? value : fallback;

const stringList = (value: unknown, fallback: string[] = []): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
        .slice(0, 128)
        .sort()
    : [...fallback];

const packVersionSettings = (
  value: unknown,
  fallback: Record<string, { enabledVersionIds: string[]; defaultVersionId: string | null }> = {},
): Record<string, { enabledVersionIds: string[]; defaultVersionId: string | null }> => {
  if (!isRecord(value)) return structuredClone(fallback);
  const result: Record<string, { enabledVersionIds: string[]; defaultVersionId: string | null }> = {};
  for (const [familyId, raw] of Object.entries(value).slice(0, 128)) {
    const family = familyId.trim();
    if (!family || family.length > 128 || !isRecord(raw)) continue;
    const enabledVersionIds = stringList(raw.enabledVersionIds).slice(0, 64);
    const defaultVersionId = stringOrNull(raw.defaultVersionId, null);
    result[family] = {
      enabledVersionIds,
      defaultVersionId: defaultVersionId && enabledVersionIds.includes(defaultVersionId) ? defaultVersionId : null,
    };
  }
  return result;
};

const acpProfiles = (
  value: unknown,
  fallback: AgentAcpWorkspaceProfileSetting[] = [],
): AgentAcpWorkspaceProfileSetting[] => {
  if (!Array.isArray(value)) return structuredClone(fallback);
  const seen = new Set<string>();
  const result: AgentAcpWorkspaceProfileSetting[] = [];
  for (const candidate of value.slice(0, 32)) {
    if (!isRecord(candidate)) continue;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const cwd = typeof candidate.cwd === 'string' ? candidate.cwd.trim() : '';
    if (
      !/^[a-z][a-z0-9_.-]{0,127}$/.test(id) ||
      seen.has(id) ||
      (cwd !== '/workspace' && !cwd.startsWith('/workspace/')) ||
      cwd.includes('\0') ||
      Buffer.byteLength(cwd, 'utf8') > 4096
    )
      continue;
    if (!Array.isArray(candidate.argv) || candidate.argv.length < 1 || candidate.argv.length > 64) continue;
    const argv = candidate.argv.filter((item): item is string => typeof item === 'string' && !item.includes('\0'));
    if (argv.length !== candidate.argv.length || argv.some((item) => Buffer.byteLength(item, 'utf8') > 8192)) continue;
    seen.add(id);
    result.push({ id, argv, cwd });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
};

const validBrowserUrlPattern = (value: string): boolean => {
  const match = /^(\*|https?|wss?):\/\/(\*\.)?([^/:?#]+)(?::(\d{1,5}))?(\/[^?#]*)?$/.exec(value.trim());
  if (!match) return false;
  const port = match[4];
  if (port && (Number(port) < 1 || Number(port) > 65535)) return false;
  const rawPath = match[5];
  return !rawPath || !rawPath.includes('*') || rawPath.endsWith('*');
};

const browserTargets = (value: unknown, fallback: AgentBrowserTargetSetting[] = []): AgentBrowserTargetSetting[] => {
  if (!Array.isArray(value)) return structuredClone(fallback);
  const seen = new Set<string>();
  const result: AgentBrowserTargetSetting[] = [];
  for (const candidate of value.slice(0, 32)) {
    if (!isRecord(candidate)) continue;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(id) || seen.has(id) || !Array.isArray(candidate.endpoints)) continue;
    const endpoints: AgentBrowserEndpointSetting[] = [];
    for (const raw of candidate.endpoints.slice(0, 16)) {
      if (!isRecord(raw)) continue;
      const scope = raw.scope;
      const url = typeof raw.url === 'string' ? raw.url.trim() : '';
      const via = raw.via ?? (scope === 'docker-network' ? 'runner' : 'backend');
      const priority = Number(raw.priority);
      if (
        (scope !== 'docker-network' && scope !== 'external-network') ||
        (via !== 'backend' && via !== 'runner') ||
        !url ||
        url.length > 4096
      )
        continue;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      if (
        !['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      )
        continue;
      const plaintext = parsed.protocol === 'http:' || parsed.protocol === 'ws:';
      const allowPlaintext = raw.allowPlaintext === true;
      if (plaintext && !allowPlaintext) continue;
      endpoints.push({
        scope,
        via,
        url: parsed.toString(),
        priority: Number.isSafeInteger(priority) && priority >= 0 && priority <= 10000 ? priority : 100,
        allowPlaintext,
        verifyTls: raw.verifyTls !== false,
      });
    }
    if (!endpoints.length) continue;
    const allowedUrlPatterns = stringList(candidate.allowedUrlPatterns)
      .filter((item) => item.length <= 2048 && validBrowserUrlPattern(item))
      .slice(0, 128);
    if (!allowedUrlPatterns.length) continue;
    seen.add(id);
    result.push({ id, endpoints: endpoints.sort((a, b) => a.priority - b.priority), allowedUrlPatterns });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
};

const pluginRepositories = (
  value: unknown,
  fallback: AgentPluginRepositorySetting[] = [],
): AgentPluginRepositorySetting[] => {
  if (!Array.isArray(value)) return structuredClone(fallback);
  const seen = new Set<string>();
  const result: AgentPluginRepositorySetting[] = [];
  for (const candidate of value.slice(0, 16)) {
    if (!isRecord(candidate) || typeof candidate.url !== 'string') continue;
    let url: URL;
    try {
      url = new URL(candidate.url.trim());
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) continue;
    const normalized = url.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({
      url: normalized,
      privateHostExceptions: stringList(candidate.privateHostExceptions).slice(0, 32),
    });
  }
  return result;
};

const section = (root: Record<string, unknown>, key: string): Record<string, unknown> =>
  isRecord(root[key]) ? root[key] : {};

export const createDefaultAgentSettings = (): AgentSettingsDocument =>
  JSON.parse(JSON.stringify(AGENT_DEFAULTS.settings)) as AgentSettingsDocument;

/** Normalizes persisted settings while keeping all effective values inside the frozen hard-limit envelope. */
const normalizeSettings = (raw: unknown, applyHardLimitCaps: boolean): AgentSettingsDocument => {
  if (!isRecord(raw)) return createDefaultAgentSettings();
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) {
    throw new Error(`Unsupported Agent settings schemaVersion: ${String(raw.schemaVersion)}`);
  }

  const defaults = createDefaultAgentSettings();
  const feature = section(raw, 'feature');
  const model = section(raw, 'model');
  const performance = section(raw, 'performance');
  const budget = section(raw, 'budget');
  const hardLimits = section(raw, 'hardLimits');
  const subagents = section(raw, 'subagents');
  const storage = section(raw, 'storage');
  const workspaceRuntime = section(raw, 'workspaceRuntime');
  const browser = section(raw, 'browser');
  const plugins = section(raw, 'plugins');
  const safety = section(raw, 'safety');

  const normalized: AgentSettingsDocument = {
    schemaVersion: 1,
    feature: { enabled: typeof feature.enabled === 'boolean' ? feature.enabled : defaults.feature.enabled },
    model: {
      defaultProviderId: stringOrNull(model.defaultProviderId, defaults.model.defaultProviderId),
      defaultModelId: stringOrNull(model.defaultModelId, defaults.model.defaultModelId),
    },
    performance: {
      maxConcurrentRuntimes: integer(performance.maxConcurrentRuntimes, defaults.performance.maxConcurrentRuntimes, 1),
      maxConcurrentModelCalls:
        performance.maxConcurrentModelCalls === 'auto'
          ? 'auto'
          : integer(performance.maxConcurrentModelCalls, defaults.performance.maxConcurrentRuntimes, 1),
    },
    budget: {
      maxContextTokens: integer(budget.maxContextTokens, defaults.budget.maxContextTokens, 1),
      maxOutputTokens: integer(budget.maxOutputTokens, defaults.budget.maxOutputTokens, 1),
      maxRunTokens: integer(budget.maxRunTokens, defaults.budget.maxRunTokens, 1),
      maxRunSteps: integer(budget.maxRunSteps, defaults.budget.maxRunSteps, 1),
      maxRunCostMicros: nullableInteger(budget.maxRunCostMicros, defaults.budget.maxRunCostMicros),
      maxActiveExecutionSeconds: integer(
        budget.maxActiveExecutionSeconds,
        defaults.budget.maxActiveExecutionSeconds,
        1,
      ),
      toolTimeoutSeconds: integer(budget.toolTimeoutSeconds, defaults.budget.toolTimeoutSeconds, 1),
      maxToolOutputBytes: integer(budget.maxToolOutputBytes, defaults.budget.maxToolOutputBytes, 1),
      maxRawToolBytes: integer(budget.maxRawToolBytes, defaults.budget.maxRawToolBytes, 1),
      maxRecallItems: integer(budget.maxRecallItems, defaults.budget.maxRecallItems, 1),
      maxRecallBytes: integer(budget.maxRecallBytes, defaults.budget.maxRecallBytes, 1),
    },
    hardLimits: {
      maxContextTokens: integer(hardLimits.maxContextTokens, defaults.hardLimits.maxContextTokens, 1),
      maxOutputTokens: integer(hardLimits.maxOutputTokens, defaults.hardLimits.maxOutputTokens, 1),
      maxRunTokens: integer(hardLimits.maxRunTokens, defaults.hardLimits.maxRunTokens, 1),
      maxRunSteps: integer(hardLimits.maxRunSteps, defaults.hardLimits.maxRunSteps, 1),
      maxRunCostMicros: nullableInteger(hardLimits.maxRunCostMicros, defaults.hardLimits.maxRunCostMicros),
      maxActiveExecutionSeconds: integer(
        hardLimits.maxActiveExecutionSeconds,
        defaults.hardLimits.maxActiveExecutionSeconds,
        1,
      ),
      toolTimeoutSeconds: integer(hardLimits.toolTimeoutSeconds, defaults.hardLimits.toolTimeoutSeconds, 1),
      maxToolOutputBytes: integer(hardLimits.maxToolOutputBytes, defaults.hardLimits.maxToolOutputBytes, 1),
      maxRawToolBytes: integer(hardLimits.maxRawToolBytes, defaults.hardLimits.maxRawToolBytes, 1),
      maxArtifactBytes: integer(hardLimits.maxArtifactBytes, defaults.hardLimits.maxArtifactBytes, 1),
      maxSingleArtifactBytes: integer(hardLimits.maxSingleArtifactBytes, defaults.hardLimits.maxSingleArtifactBytes, 1),
      maxGlobalArtifactBytes: integer(hardLimits.maxGlobalArtifactBytes, defaults.hardLimits.maxGlobalArtifactBytes, 1),
      maxRecallItems: integer(hardLimits.maxRecallItems, defaults.hardLimits.maxRecallItems, 1),
      maxRecallBytes: integer(hardLimits.maxRecallBytes, defaults.hardLimits.maxRecallBytes, 1),
      maxConcurrentRuntimes: integer(hardLimits.maxConcurrentRuntimes, defaults.hardLimits.maxConcurrentRuntimes, 1),
      maxConcurrentModelCalls: integer(
        hardLimits.maxConcurrentModelCalls,
        defaults.hardLimits.maxConcurrentModelCalls,
        1,
      ),
      maxDelegationDepth: integer(hardLimits.maxDelegationDepth, defaults.hardLimits.maxDelegationDepth, 1),
      maxSubagentMessagesPerRun: integer(
        hardLimits.maxSubagentMessagesPerRun,
        defaults.hardLimits.maxSubagentMessagesPerRun,
        1,
      ),
      maxSubagentMessageBytesPerRun: integer(
        hardLimits.maxSubagentMessageBytesPerRun,
        defaults.hardLimits.maxSubagentMessageBytesPerRun,
        1,
      ),
      maxActiveWorkspaces: integer(hardLimits.maxActiveWorkspaces, defaults.hardLimits.maxActiveWorkspaces, 1),
      unretainedArtifactTtlSeconds: integer(
        hardLimits.unretainedArtifactTtlSeconds,
        defaults.hardLimits.unretainedArtifactTtlSeconds,
        1,
      ),
      workspaceIdleTtlSeconds: integer(
        hardLimits.workspaceIdleTtlSeconds,
        defaults.hardLimits.workspaceIdleTtlSeconds,
        1,
      ),
    },
    subagents: {
      maxDelegationDepth: integer(subagents.maxDelegationDepth, defaults.subagents.maxDelegationDepth, 1),
      maxSubagentMessagesPerRun: integer(
        subagents.maxSubagentMessagesPerRun,
        defaults.subagents.maxSubagentMessagesPerRun,
        1,
      ),
      maxSubagentMessageBytesPerRun: integer(
        subagents.maxSubagentMessageBytesPerRun,
        defaults.subagents.maxSubagentMessageBytesPerRun,
        1,
      ),
    },
    storage: {
      maxArtifactBytes: integer(storage.maxArtifactBytes, defaults.storage.maxArtifactBytes, 1),
      maxSingleArtifactBytes: integer(storage.maxSingleArtifactBytes, defaults.storage.maxSingleArtifactBytes, 1),
      maxGlobalArtifactBytes: integer(storage.maxGlobalArtifactBytes, defaults.storage.maxGlobalArtifactBytes, 1),
      unretainedArtifactTtlSeconds: integer(
        storage.unretainedArtifactTtlSeconds,
        defaults.storage.unretainedArtifactTtlSeconds,
        1,
      ),
    },
    workspaceRuntime: {
      maxActiveWorkspaces: integer(
        workspaceRuntime.maxActiveWorkspaces,
        defaults.workspaceRuntime.maxActiveWorkspaces,
        1,
      ),
      workspaceIdleTtlSeconds: integer(
        workspaceRuntime.workspaceIdleTtlSeconds,
        defaults.workspaceRuntime.workspaceIdleTtlSeconds,
        1,
      ),
      enabledRecipeIds: stringList(workspaceRuntime.enabledRecipeIds, defaults.workspaceRuntime.enabledRecipeIds),
      toolVersions: packVersionSettings(workspaceRuntime.toolVersions, defaults.workspaceRuntime.toolVersions),
      acpProfiles: acpProfiles(workspaceRuntime.acpProfiles, defaults.workspaceRuntime.acpProfiles),
    },
    browser: {
      targets: browserTargets(browser.targets ?? workspaceRuntime.browserTargets, defaults.browser.targets),
    },
    plugins: {
      repositories: pluginRepositories(plugins.repositories, defaults.plugins.repositories),
    },
    safety: {
      providerPrivateNetworkExceptions: Array.isArray(safety.providerPrivateNetworkExceptions)
        ? safety.providerPrivateNetworkExceptions.filter((value): value is string => typeof value === 'string')
        : defaults.safety.providerPrivateNetworkExceptions,
    },
  };

  if (!applyHardLimitCaps) return normalized;

  normalized.performance.maxConcurrentRuntimes = Math.min(
    normalized.performance.maxConcurrentRuntimes,
    normalized.hardLimits.maxConcurrentRuntimes,
  );
  if (normalized.performance.maxConcurrentModelCalls !== 'auto') {
    normalized.performance.maxConcurrentModelCalls = Math.min(
      normalized.performance.maxConcurrentModelCalls,
      normalized.hardLimits.maxConcurrentModelCalls,
      normalized.performance.maxConcurrentRuntimes,
    );
  }

  const cappedPairs: Array<[keyof AgentSettingsDocument['budget'], keyof AgentSettingsDocument['hardLimits']]> = [
    ['maxContextTokens', 'maxContextTokens'],
    ['maxOutputTokens', 'maxOutputTokens'],
    ['maxRunTokens', 'maxRunTokens'],
    ['maxRunSteps', 'maxRunSteps'],
    ['maxActiveExecutionSeconds', 'maxActiveExecutionSeconds'],
    ['toolTimeoutSeconds', 'toolTimeoutSeconds'],
    ['maxToolOutputBytes', 'maxToolOutputBytes'],
    ['maxRawToolBytes', 'maxRawToolBytes'],
    ['maxRecallItems', 'maxRecallItems'],
    ['maxRecallBytes', 'maxRecallBytes'],
  ];
  for (const [softKey, hardKey] of cappedPairs) {
    const soft = normalized.budget[softKey];
    const hard = normalized.hardLimits[hardKey];
    if (typeof soft === 'number' && typeof hard === 'number' && soft > hard) {
      (normalized.budget as unknown as Record<string, number | null>)[softKey] = hard;
    }
  }
  if (
    normalized.budget.maxRunCostMicros !== null &&
    normalized.hardLimits.maxRunCostMicros !== null &&
    normalized.budget.maxRunCostMicros > normalized.hardLimits.maxRunCostMicros
  ) {
    normalized.budget.maxRunCostMicros = normalized.hardLimits.maxRunCostMicros;
  }

  normalized.subagents.maxDelegationDepth = Math.min(
    normalized.subagents.maxDelegationDepth,
    normalized.hardLimits.maxDelegationDepth,
  );
  normalized.subagents.maxSubagentMessagesPerRun = Math.min(
    normalized.subagents.maxSubagentMessagesPerRun,
    normalized.hardLimits.maxSubagentMessagesPerRun,
  );
  normalized.subagents.maxSubagentMessageBytesPerRun = Math.min(
    normalized.subagents.maxSubagentMessageBytesPerRun,
    normalized.hardLimits.maxSubagentMessageBytesPerRun,
  );
  normalized.storage.maxArtifactBytes = Math.min(
    normalized.storage.maxArtifactBytes,
    normalized.hardLimits.maxArtifactBytes,
  );
  normalized.storage.maxSingleArtifactBytes = Math.min(
    normalized.storage.maxSingleArtifactBytes,
    normalized.hardLimits.maxSingleArtifactBytes,
  );
  normalized.storage.maxGlobalArtifactBytes = Math.min(
    normalized.storage.maxGlobalArtifactBytes,
    normalized.hardLimits.maxGlobalArtifactBytes,
  );
  normalized.storage.unretainedArtifactTtlSeconds = Math.min(
    normalized.storage.unretainedArtifactTtlSeconds,
    normalized.hardLimits.unretainedArtifactTtlSeconds,
  );
  normalized.workspaceRuntime.maxActiveWorkspaces = Math.min(
    normalized.workspaceRuntime.maxActiveWorkspaces,
    normalized.hardLimits.maxActiveWorkspaces,
  );
  normalized.workspaceRuntime.workspaceIdleTtlSeconds = Math.min(
    normalized.workspaceRuntime.workspaceIdleTtlSeconds,
    normalized.hardLimits.workspaceIdleTtlSeconds,
  );

  return normalized;
};

/** Normalizes administrator-requested values without applying hard-limit caps. */
export const normalizeRequestedSettings = (raw: unknown): AgentSettingsDocument => normalizeSettings(raw, false);

/** Returns the effective settings after applying the configured hard-limit envelope. */
export const validateSettings = (raw: unknown): AgentSettingsDocument => normalizeSettings(raw, true);

export const snapshotBudget = (settings: AgentSettingsDocument): AgentRunBudgetSnapshot => ({
  maxRunTokens: settings.budget.maxRunTokens,
  maxRunSteps: settings.budget.maxRunSteps,
  maxRunCostMicros: settings.budget.maxRunCostMicros,
  maxActiveExecutionSeconds: settings.budget.maxActiveExecutionSeconds,
});
