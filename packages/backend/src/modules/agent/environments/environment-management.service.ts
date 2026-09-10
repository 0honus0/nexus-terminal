import { randomUUID } from 'node:crypto';
import { createDefaultAgentSettings, type AgentSettingsDocument } from '../agent-defaults';
import type { JsonValue } from '../agent.types';
import type { AgentSettingsService } from '../host/agent-settings.service';
import type { EnvironmentConfirmationRepositoryPort } from './environment-confirmation.repository.port';
import type { EnvironmentControllerPort } from './environment-controller.port';
import type { EnvironmentRepositoryPort } from './environment.repository.port';
import { EnvironmentService, resolveEnvironmentPacks } from './environment.service';
import type {
  EnvironmentCatalog,
  EnvironmentCatalogPack,
  EnvironmentCommandView,
  EnvironmentPackRef,
  EnvironmentPackUninstallPreview,
  EnvironmentRuntimeCleanupPreview,
  EnvironmentSettingsResetPreview,
  EnvironmentSetupPreview,
  EnvironmentSetupRecipeSelection,
} from './environment.types';

const CONFIRMATION_TTL_SECONDS = 10 * 60;
const ACTIVE_ENVIRONMENT_STATUSES = new Set(['creating', 'starting', 'running', 'stopping', 'deleting']);

const asJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const record = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED');
  return value as Record<string, JsonValue>;
};

const normalizeSelections = (value: unknown): EnvironmentSetupRecipeSelection[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new Error('VALIDATION_FAILED');
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('VALIDATION_FAILED');
    const input = raw as Record<string, unknown>;
    const recipeId = typeof input.recipeId === 'string' ? input.recipeId.trim() : '';
    if (!recipeId || recipeId.length > 128 || seen.has(recipeId)) throw new Error('VALIDATION_FAILED');
    seen.add(recipeId);
    const versions: Record<string, string> = {};
    if (input.versions !== undefined) {
      if (!input.versions || typeof input.versions !== 'object' || Array.isArray(input.versions)) {
        throw new Error('VALIDATION_FAILED');
      }
      const entries = Object.entries(input.versions as Record<string, unknown>);
      if (entries.length > 64) throw new Error('VALIDATION_FAILED');
      for (const [familyId, versionValue] of entries) {
        const family = familyId.trim();
        const version = typeof versionValue === 'string' ? versionValue.trim() : '';
        if (!family || !version || family.length > 128 || version.length > 128) throw new Error('VALIDATION_FAILED');
        versions[family] = version;
      }
    }
    return { recipeId, ...(Object.keys(versions).length ? { versions } : {}) };
  });
};

const findPack = (catalog: EnvironmentCatalog, familyId: string, versionId: string): EnvironmentCatalogPack => {
  const family = familyId.trim();
  const version = versionId.trim();
  if (!family || !version || family.length > 128 || version.length > 128) throw new Error('VALIDATION_FAILED');
  const pack = catalog.packs.find((candidate) => candidate.familyId === family && candidate.versionId === version);
  if (!pack || pack.status === 'unavailable' || !pack.contentDigest) throw new Error('ENVIRONMENT_PACK_UNAVAILABLE');
  return pack;
};

const packRef = (pack: EnvironmentCatalogPack): EnvironmentPackRef => ({
  familyId: pack.familyId,
  versionId: pack.versionId,
  contentDigest: pack.contentDigest,
});

const uniqueRefs = (refs: readonly EnvironmentPackRef[]): EnvironmentPackRef[] => {
  const values = new Map<string, EnvironmentPackRef>();
  for (const ref of refs) values.set(`${ref.familyId}\u0000${ref.versionId}\u0000${ref.contentDigest}`, ref);
  return [...values.values()].sort(
    (a, b) =>
      a.familyId.localeCompare(b.familyId) ||
      a.versionId.localeCompare(b.versionId) ||
      a.contentDigest.localeCompare(b.contentDigest),
  );
};

const setupPlan = (
  catalog: EnvironmentCatalog,
  settings: AgentSettingsDocument['environments'],
  selections: readonly EnvironmentSetupRecipeSelection[],
): { environments: AgentSettingsDocument['environments']; packs: EnvironmentPackRef[] } => {
  const next = structuredClone(settings);
  const enabledRecipeIds = new Set(next.enabledRecipeIds);
  const refs: EnvironmentPackRef[] = [];
  for (const selection of selections) {
    const recipe = catalog.recipes.find((candidate) => candidate.id === selection.recipeId);
    if (!recipe) throw new Error('ENVIRONMENT_RECIPE_NOT_FOUND');
    enabledRecipeIds.add(recipe.id);
    const resolved = resolveEnvironmentPacks(catalog, recipe.id, selection.versions);
    refs.push(...resolved);
    for (const ref of resolved) {
      const current = next.packVersions[ref.familyId] ?? { enabledVersionIds: [], defaultVersionId: null };
      const enabled = new Set(current.enabledVersionIds);
      enabled.add(ref.versionId);
      next.packVersions[ref.familyId] = {
        enabledVersionIds: [...enabled].sort(),
        defaultVersionId: selection.versions?.[ref.familyId] ?? current.defaultVersionId ?? ref.versionId,
      };
    }
  }
  next.enabledRecipeIds = [...enabledRecipeIds].sort();
  return { environments: next, packs: uniqueRefs(refs) };
};

export class EnvironmentManagementService {
  constructor(
    private readonly controller: EnvironmentControllerPort,
    private readonly repository: EnvironmentRepositoryPort,
    private readonly confirmations: EnvironmentConfirmationRepositoryPort,
    private readonly settings: AgentSettingsService,
    private readonly environments: EnvironmentService,
    private readonly now: () => number,
  ) {}

  async previewSetup(
    userId: number,
    selectionsInput: unknown,
    expectedVersion: number,
  ): Promise<EnvironmentSetupPreview> {
    const selections = normalizeSelections(selectionsInput);
    const [settings, catalog, storage] = await Promise.all([
      this.settings.get(userId),
      this.currentCatalog(),
      this.controller.storage(),
    ]);
    if (settings.revision !== expectedVersion) throw new Error('SETTINGS_VERSION_CONFLICT');
    const plan = setupPlan(catalog, settings.requestedSettings.environments, selections);
    const missingPacks = plan.packs.filter((ref) => {
      const candidate = catalog.packs.find(
        (pack) =>
          pack.familyId === ref.familyId &&
          pack.versionId === ref.versionId &&
          pack.contentDigest === ref.contentDigest,
      );
      return !candidate?.installed;
    });
    const installBytes = missingPacks.reduce((total, ref) => {
      const candidate = catalog.packs.find(
        (pack) =>
          pack.familyId === ref.familyId &&
          pack.versionId === ref.versionId &&
          pack.contentDigest === ref.contentDigest,
      );
      return total + (candidate?.diskBytes ?? 0);
    }, 0);
    if (storage.filesystem.freeBytes < installBytes) throw new Error('RESOURCE_UNAVAILABLE');
    const now = this.now();
    const preview: EnvironmentSetupPreview = {
      confirmationId: randomUUID(),
      expectedVersion,
      catalogRevision: catalog.revision,
      enabledRecipeIds: plan.environments.enabledRecipeIds,
      packs: plan.packs,
      missingPacks,
      installBytes,
      expiresAt: now + CONFIRMATION_TTL_SECONDS,
    };
    await this.confirmations.deleteExpired(now);
    await this.confirmations.save({
      id: preview.confirmationId,
      userId,
      kind: 'setup',
      expectedSettingsRevision: expectedVersion,
      catalogRevision: catalog.revision,
      payload: asJson({ selections }),
      snapshot: asJson(preview),
      createdAt: now,
      expiresAt: preview.expiresAt,
    });
    return preview;
  }

  async confirmSetup(userId: number, confirmationId: string, expectedVersion: number): Promise<EnvironmentCommandView> {
    const confirmation = await this.loadConfirmation(userId, confirmationId, 'setup', expectedVersion);
    const [settings, catalog] = await Promise.all([this.settings.get(userId), this.currentCatalog()]);
    this.assertRevisions(
      settings.revision,
      catalog.revision,
      confirmation.expectedSettingsRevision,
      confirmation.catalogRevision,
    );
    const selections = normalizeSelections(record(confirmation.payload).selections);
    const plan = setupPlan(catalog, settings.requestedSettings.environments, selections);
    await this.settings.patch(userId, { environments: plan.environments }, expectedVersion);
    await this.confirmations.delete(userId, confirmationId);
    return this.environments.adminAction(userId, 'packInstall', asJson({ packs: plan.packs }));
  }

  async installPack(userId: number, familyId: string, versionId: string): Promise<EnvironmentCommandView> {
    const catalog = await this.currentCatalog();
    const pack = findPack(catalog, familyId, versionId);
    return this.environments.adminAction(userId, 'packInstall', asJson({ packs: [packRef(pack)] }));
  }

  async previewPackUninstall(
    userId: number,
    familyId: string,
    versionId: string,
    expectedVersion: number,
  ): Promise<EnvironmentPackUninstallPreview> {
    const [settings, catalog, storage] = await Promise.all([
      this.settings.get(userId),
      this.currentCatalog(),
      this.controller.storage(),
    ]);
    if (settings.revision !== expectedVersion) throw new Error('SETTINGS_VERSION_CONFLICT');
    const pack = findPack(catalog, familyId, versionId);
    const current = settings.requestedSettings.environments.packVersions[pack.familyId] ?? {
      enabledVersionIds: [],
      defaultVersionId: null,
    };
    const remainingEnabled = current.enabledVersionIds.filter((value) => value !== pack.versionId).sort();
    const replacementDefaultVersionId =
      current.defaultVersionId === pack.versionId ? (remainingEnabled[0] ?? null) : current.defaultVersionId;
    const bytes =
      storage.byPack.find((entry) => entry.familyId === pack.familyId && entry.versionId === pack.versionId)?.bytes ??
      pack.diskBytes;
    const now = this.now();
    const preview: EnvironmentPackUninstallPreview = {
      confirmationId: randomUUID(),
      expectedVersion,
      catalogRevision: catalog.revision,
      pack: { ...packRef(pack), displayName: pack.displayName, bytes },
      installed: pack.installed,
      inUse: pack.inUse,
      wasEnabled: current.enabledVersionIds.includes(pack.versionId),
      wasDefault: current.defaultVersionId === pack.versionId,
      replacementDefaultVersionId,
      expiresAt: now + CONFIRMATION_TTL_SECONDS,
    };
    await this.confirmations.deleteExpired(now);
    await this.confirmations.save({
      id: preview.confirmationId,
      userId,
      kind: 'packUninstall',
      expectedSettingsRevision: expectedVersion,
      catalogRevision: catalog.revision,
      payload: asJson({
        familyId: pack.familyId,
        versionId: pack.versionId,
        contentDigest: pack.contentDigest,
        enabledVersionIds: remainingEnabled,
        defaultVersionId: replacementDefaultVersionId,
      }),
      snapshot: asJson(preview),
      createdAt: now,
      expiresAt: preview.expiresAt,
    });
    return preview;
  }

  async confirmPackUninstall(
    userId: number,
    confirmationId: string,
    expectedVersion: number,
  ): Promise<EnvironmentCommandView> {
    const confirmation = await this.loadConfirmation(userId, confirmationId, 'packUninstall', expectedVersion);
    const [settings, catalog] = await Promise.all([this.settings.get(userId), this.currentCatalog()]);
    this.assertRevisions(
      settings.revision,
      catalog.revision,
      confirmation.expectedSettingsRevision,
      confirmation.catalogRevision,
    );
    const payload = record(confirmation.payload);
    const familyId = String(payload.familyId ?? '');
    const versionId = String(payload.versionId ?? '');
    const expectedDigest = String(payload.contentDigest ?? '');
    const pack = findPack(catalog, familyId, versionId);
    if (pack.contentDigest !== expectedDigest) throw new Error('CATALOG_REVISION_CONFLICT');
    if (pack.inUse) throw new Error('ENVIRONMENT_PACK_IN_USE');
    const next = structuredClone(settings.requestedSettings.environments);
    next.packVersions[familyId] = {
      enabledVersionIds: Array.isArray(payload.enabledVersionIds)
        ? payload.enabledVersionIds.filter((value): value is string => typeof value === 'string')
        : [],
      defaultVersionId: typeof payload.defaultVersionId === 'string' ? payload.defaultVersionId : null,
    };
    if (JSON.stringify(next) !== JSON.stringify(settings.requestedSettings.environments)) {
      await this.settings.patch(userId, { environments: next }, expectedVersion);
    }
    await this.confirmations.delete(userId, confirmationId);
    return this.environments.adminAction(userId, 'packUninstall', asJson({ pack: packRef(pack) }));
  }

  async previewRuntimeCleanup(userId: number, expectedVersion: number): Promise<EnvironmentRuntimeCleanupPreview> {
    const [settings, catalog, storage, owned] = await Promise.all([
      this.settings.get(userId),
      this.currentCatalog(),
      this.controller.storage(),
      this.repository.listUserEnvironments(userId),
    ]);
    if (settings.revision !== expectedVersion) throw new Error('SETTINGS_VERSION_CONFLICT');
    const active = owned.filter(({ environment }) => ACTIVE_ENVIRONMENT_STATUSES.has(environment.status));
    const retained = owned.filter((candidate) => candidate.retained);
    const candidates = owned.filter(
      ({ retained: isRetained, environment }) => !isRetained && !ACTIVE_ENVIRONMENT_STATUSES.has(environment.status),
    );
    const bytes = new Map(storage.byEnvironment.map((item) => [item.environmentId, item.runtimeBytes] as const));
    const now = this.now();
    const preview: EnvironmentRuntimeCleanupPreview = {
      confirmationId: randomUUID(),
      expectedVersion,
      catalogRevision: catalog.revision,
      environmentCount: candidates.length,
      activeCount: active.length,
      retainedCount: retained.length,
      estimatedReclaimableBytes: candidates.reduce(
        (total, candidate) => total + (bytes.get(candidate.environment.id) ?? 0),
        0,
      ),
      environmentIds: candidates.map((candidate) => candidate.environment.id).sort(),
      expiresAt: now + CONFIRMATION_TTL_SECONDS,
    };
    await this.confirmations.deleteExpired(now);
    await this.confirmations.save({
      id: preview.confirmationId,
      userId,
      kind: 'runtimeCleanup',
      expectedSettingsRevision: expectedVersion,
      catalogRevision: catalog.revision,
      payload: asJson({ environmentIds: preview.environmentIds }),
      snapshot: asJson(preview),
      createdAt: now,
      expiresAt: preview.expiresAt,
    });
    return preview;
  }

  async confirmRuntimeCleanup(
    userId: number,
    confirmationId: string,
    expectedVersion: number,
  ): Promise<EnvironmentCommandView> {
    const confirmation = await this.loadConfirmation(userId, confirmationId, 'runtimeCleanup', expectedVersion);
    const [settings, catalog] = await Promise.all([this.settings.get(userId), this.currentCatalog()]);
    this.assertRevisions(
      settings.revision,
      catalog.revision,
      confirmation.expectedSettingsRevision,
      confirmation.catalogRevision,
    );
    await this.confirmations.delete(userId, confirmationId);
    return this.environments.adminAction(userId, 'runtimeCleanup', {});
  }

  async previewSettingsReset(userId: number, expectedVersion: number): Promise<EnvironmentSettingsResetPreview> {
    const [settings, catalog] = await Promise.all([this.settings.get(userId), this.currentCatalog()]);
    if (settings.revision !== expectedVersion) throw new Error('SETTINGS_VERSION_CONFLICT');
    const proposed = createDefaultAgentSettings().environments;
    const now = this.now();
    const preview: EnvironmentSettingsResetPreview = {
      confirmationId: randomUUID(),
      expectedVersion,
      catalogRevision: catalog.revision,
      current: asJson(settings.requestedSettings.environments),
      proposed: asJson(proposed),
      expiresAt: now + CONFIRMATION_TTL_SECONDS,
    };
    await this.confirmations.deleteExpired(now);
    await this.confirmations.save({
      id: preview.confirmationId,
      userId,
      kind: 'settingsReset',
      expectedSettingsRevision: expectedVersion,
      catalogRevision: catalog.revision,
      payload: asJson({ proposed }),
      snapshot: asJson(preview),
      createdAt: now,
      expiresAt: preview.expiresAt,
    });
    return preview;
  }

  async confirmSettingsReset(userId: number, confirmationId: string, expectedVersion: number) {
    const confirmation = await this.loadConfirmation(userId, confirmationId, 'settingsReset', expectedVersion);
    const [settings, catalog] = await Promise.all([this.settings.get(userId), this.currentCatalog()]);
    this.assertRevisions(
      settings.revision,
      catalog.revision,
      confirmation.expectedSettingsRevision,
      confirmation.catalogRevision,
    );
    const proposed = record(confirmation.payload).proposed;
    const updated = await this.settings.patch(userId, { environments: proposed }, expectedVersion);
    await this.confirmations.delete(userId, confirmationId);
    return updated;
  }

  private async currentCatalog(): Promise<EnvironmentCatalog> {
    const availability = await this.controller.availability();
    if (!availability.available) throw new Error('ENVIRONMENT_CONTROLLER_UNAVAILABLE');
    return this.controller.catalog();
  }

  private async loadConfirmation(
    userId: number,
    confirmationId: string,
    kind: 'setup' | 'packUninstall' | 'runtimeCleanup' | 'settingsReset',
    expectedVersion: number,
  ) {
    if (
      !confirmationId ||
      confirmationId.length > 128 ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const confirmation = await this.confirmations.get(userId, confirmationId);
    if (!confirmation || confirmation.kind !== kind) throw new Error('ENVIRONMENT_CONFIRMATION_NOT_FOUND');
    if (confirmation.expiresAt <= this.now()) {
      await this.confirmations.delete(userId, confirmationId);
      throw new Error('ENVIRONMENT_CONFIRMATION_EXPIRED');
    }
    if (confirmation.expectedSettingsRevision !== expectedVersion) throw new Error('SETTINGS_VERSION_CONFLICT');
    return confirmation;
  }

  private assertRevisions(
    currentSettings: number,
    currentCatalog: string,
    expectedSettings: number,
    expectedCatalog: string,
  ): void {
    if (currentSettings !== expectedSettings) throw new Error('SETTINGS_VERSION_CONFLICT');
    if (currentCatalog !== expectedCatalog) throw new Error('CATALOG_REVISION_CONFLICT');
  }
}
