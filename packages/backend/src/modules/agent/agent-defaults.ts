export interface AgentRunBudgetSnapshot {
  maxRunSteps: number;
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
    fallbackModels: Array<{ providerId: string; modelId: string }>;
  };
  performance: {
    maxConcurrentRuntimes: number;
    maxConcurrentModelCalls: 'auto' | number;
  };
  budget: {
    maxRunSteps: number;
    maxActiveExecutionSeconds: number;
    toolTimeoutSeconds: number;
    maxToolOutputBytes: number;
    maxRecallItems: number;
    maxRecallBytes: number;
  };
  hardLimits: {
    maxRunSteps: number;
    maxActiveExecutionSeconds: number;
    toolTimeoutSeconds: number;
    maxToolOutputBytes: number;
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
}

export const AGENT_DEFAULTS = {
  minFreeDiskBytes: 1_073_741_824,
  modelRetryCount: 2,
  settings: {
    schemaVersion: 1,
    feature: { enabled: false },
    model: { defaultProviderId: null, defaultModelId: null, fallbackModels: [] },
    performance: { maxConcurrentRuntimes: 2, maxConcurrentModelCalls: 'auto' },
    budget: {
      maxRunSteps: 80,
      maxActiveExecutionSeconds: 1_800,
      toolTimeoutSeconds: 60,
      maxToolOutputBytes: 65_536,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
    },
    hardLimits: {
      maxRunSteps: 400,
      maxActiveExecutionSeconds: 7_200,
      toolTimeoutSeconds: 300,
      maxToolOutputBytes: 262_144,
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
      enabledRecipeIds: [],
      toolVersions: {},
      acpProfiles: [],
    },
    browser: { targets: [] },
    plugins: { repositories: [] },
  } satisfies AgentSettingsDocument,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const assertExactKeys = (value: Record<string, unknown>, allowedKeys: readonly string[]): void => {
  const allowed = new Set(allowedKeys);
  const keys = Object.keys(value);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
    throw new Error('VALIDATION_FAILED');
  }
};

const integer = (value: unknown, fallback: number, minimum = 0): number =>
  Number.isSafeInteger(value) && (value as number) >= minimum ? (value as number) : fallback;

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
    assertExactKeys(raw, ['enabledVersionIds', 'defaultVersionId']);
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
    assertExactKeys(candidate, ['id', 'argv', 'cwd']);
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
    assertExactKeys(candidate, ['id', 'endpoints', 'allowedUrlPatterns']);
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(id) || seen.has(id) || !Array.isArray(candidate.endpoints)) continue;
    const endpoints: AgentBrowserEndpointSetting[] = [];
    for (const raw of candidate.endpoints.slice(0, 16)) {
      if (!isRecord(raw)) continue;
      assertExactKeys(raw, ['scope', 'via', 'url', 'priority', 'allowPlaintext', 'verifyTls']);
      const scope = raw.scope;
      const url = typeof raw.url === 'string' ? raw.url.trim() : '';
      const via = raw.via;
      const priority = Number(raw.priority);
      if (
        (scope !== 'docker-network' && scope !== 'external-network') ||
        (via !== 'backend' && via !== 'runner') ||
        !Number.isSafeInteger(priority) ||
        priority < 0 ||
        priority > 10000 ||
        typeof raw.allowPlaintext !== 'boolean' ||
        typeof raw.verifyTls !== 'boolean' ||
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
      const allowPlaintext = raw.allowPlaintext;
      if (plaintext && !allowPlaintext) continue;
      endpoints.push({
        scope,
        via,
        url: parsed.toString(),
        priority,
        allowPlaintext,
        verifyTls: raw.verifyTls,
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
    assertExactKeys(candidate, ['url']);
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
    result.push({ url: normalized });
  }
  return result;
};

const exactRecord = (
  root: Record<string, unknown>,
  key: string,
  allowedKeys: readonly string[],
): Record<string, unknown> => {
  const value = root[key];
  if (!isRecord(value)) throw new Error('VALIDATION_FAILED');
  assertExactKeys(value, allowedKeys);
  return value;
};

export const createDefaultAgentSettings = (): AgentSettingsDocument =>
  JSON.parse(JSON.stringify(AGENT_DEFAULTS.settings)) as AgentSettingsDocument;

/** Normalizes current persisted settings while keeping all effective values inside the frozen hard-limit envelope. */
const normalizeSettings = (raw: unknown, applyHardLimitCaps: boolean): AgentSettingsDocument => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const topLevelKeys = [
    'schemaVersion',
    'feature',
    'model',
    'performance',
    'budget',
    'hardLimits',
    'subagents',
    'storage',
    'workspaceRuntime',
    'browser',
    'plugins',
  ] as const;
  const allowedTopLevel = new Set<string>(topLevelKeys);
  if (
    raw.schemaVersion !== 1 ||
    Object.keys(raw).length !== topLevelKeys.length ||
    Object.keys(raw).some((key) => !allowedTopLevel.has(key))
  ) {
    throw new Error('VALIDATION_FAILED');
  }

  const defaults = createDefaultAgentSettings();
  const feature = exactRecord(raw, 'feature', ['enabled']);
  const model = exactRecord(raw, 'model', ['defaultProviderId', 'defaultModelId', 'fallbackModels']);
  const performance = exactRecord(raw, 'performance', ['maxConcurrentRuntimes', 'maxConcurrentModelCalls']);
  const budget = exactRecord(raw, 'budget', [
    'maxRunSteps',
    'maxActiveExecutionSeconds',
    'toolTimeoutSeconds',
    'maxToolOutputBytes',
    'maxRecallItems',
    'maxRecallBytes',
  ]);
  const hardLimits = exactRecord(raw, 'hardLimits', [
    'maxRunSteps',
    'maxActiveExecutionSeconds',
    'toolTimeoutSeconds',
    'maxToolOutputBytes',
    'maxArtifactBytes',
    'maxSingleArtifactBytes',
    'maxGlobalArtifactBytes',
    'maxRecallItems',
    'maxRecallBytes',
    'maxConcurrentRuntimes',
    'maxConcurrentModelCalls',
    'maxDelegationDepth',
    'maxSubagentMessagesPerRun',
    'maxSubagentMessageBytesPerRun',
    'maxActiveWorkspaces',
    'unretainedArtifactTtlSeconds',
  ]);
  const subagents = exactRecord(raw, 'subagents', [
    'maxDelegationDepth',
    'maxSubagentMessagesPerRun',
    'maxSubagentMessageBytesPerRun',
  ]);
  const storage = exactRecord(raw, 'storage', [
    'maxArtifactBytes',
    'maxSingleArtifactBytes',
    'maxGlobalArtifactBytes',
    'unretainedArtifactTtlSeconds',
  ]);
  const workspaceRuntime = exactRecord(raw, 'workspaceRuntime', [
    'maxActiveWorkspaces',
    'enabledRecipeIds',
    'toolVersions',
    'acpProfiles',
  ]);
  const browser = exactRecord(raw, 'browser', ['targets']);
  const plugins = exactRecord(raw, 'plugins', ['repositories']);

  const normalized: AgentSettingsDocument = {
    schemaVersion: 1,
    feature: { enabled: typeof feature.enabled === 'boolean' ? feature.enabled : defaults.feature.enabled },
    model: {
      defaultProviderId: stringOrNull(model.defaultProviderId, defaults.model.defaultProviderId),
      defaultModelId: stringOrNull(model.defaultModelId, defaults.model.defaultModelId),
      fallbackModels: Array.isArray(model.fallbackModels)
        ? model.fallbackModels
            .slice(0, 8)
            .flatMap((candidate) => {
              if (!isRecord(candidate)) return [];
              assertExactKeys(candidate, ['providerId', 'modelId']);
              if (typeof candidate.providerId !== 'string' || typeof candidate.modelId !== 'string') return [];
              const providerId = candidate.providerId.trim();
              const modelId = candidate.modelId.trim();
              return providerId && modelId ? [{ providerId, modelId }] : [];
            })
            .filter(
              (candidate, index, values) =>
                values.findIndex(
                  (value) => value.providerId === candidate.providerId && value.modelId === candidate.modelId,
                ) === index,
            )
        : structuredClone(defaults.model.fallbackModels),
    },
    performance: {
      maxConcurrentRuntimes: integer(performance.maxConcurrentRuntimes, defaults.performance.maxConcurrentRuntimes, 1),
      maxConcurrentModelCalls:
        performance.maxConcurrentModelCalls === 'auto'
          ? 'auto'
          : integer(performance.maxConcurrentModelCalls, defaults.performance.maxConcurrentRuntimes, 1),
    },
    budget: {
      maxRunSteps: integer(budget.maxRunSteps, defaults.budget.maxRunSteps, 1),
      maxActiveExecutionSeconds: integer(
        budget.maxActiveExecutionSeconds,
        defaults.budget.maxActiveExecutionSeconds,
        1,
      ),
      toolTimeoutSeconds: integer(budget.toolTimeoutSeconds, defaults.budget.toolTimeoutSeconds, 1),
      maxToolOutputBytes: integer(budget.maxToolOutputBytes, defaults.budget.maxToolOutputBytes, 1),
      maxRecallItems: integer(budget.maxRecallItems, defaults.budget.maxRecallItems, 1),
      maxRecallBytes: integer(budget.maxRecallBytes, defaults.budget.maxRecallBytes, 1),
    },
    hardLimits: {
      maxRunSteps: integer(hardLimits.maxRunSteps, defaults.hardLimits.maxRunSteps, 1),
      maxActiveExecutionSeconds: integer(
        hardLimits.maxActiveExecutionSeconds,
        defaults.hardLimits.maxActiveExecutionSeconds,
        1,
      ),
      toolTimeoutSeconds: integer(hardLimits.toolTimeoutSeconds, defaults.hardLimits.toolTimeoutSeconds, 1),
      maxToolOutputBytes: integer(hardLimits.maxToolOutputBytes, defaults.hardLimits.maxToolOutputBytes, 1),
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
      enabledRecipeIds: stringList(workspaceRuntime.enabledRecipeIds, defaults.workspaceRuntime.enabledRecipeIds),
      toolVersions: packVersionSettings(workspaceRuntime.toolVersions, defaults.workspaceRuntime.toolVersions),
      acpProfiles: acpProfiles(workspaceRuntime.acpProfiles, defaults.workspaceRuntime.acpProfiles),
    },
    browser: {
      targets: browserTargets(browser.targets, defaults.browser.targets),
    },
    plugins: {
      repositories: pluginRepositories(plugins.repositories, defaults.plugins.repositories),
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
    ['maxRunSteps', 'maxRunSteps'],
    ['maxActiveExecutionSeconds', 'maxActiveExecutionSeconds'],
    ['toolTimeoutSeconds', 'toolTimeoutSeconds'],
    ['maxToolOutputBytes', 'maxToolOutputBytes'],
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

  return normalized;
};

/** Normalizes administrator-requested values without applying hard-limit caps. */
export const normalizeRequestedSettings = (raw: unknown): AgentSettingsDocument => normalizeSettings(raw, false);

/** Returns the effective settings after applying the configured hard-limit envelope. */
export const validateSettings = (raw: unknown): AgentSettingsDocument => normalizeSettings(raw, true);

export const snapshotBudget = (settings: AgentSettingsDocument): AgentRunBudgetSnapshot => ({
  maxRunSteps: settings.budget.maxRunSteps,
  maxActiveExecutionSeconds: settings.budget.maxActiveExecutionSeconds,
});
