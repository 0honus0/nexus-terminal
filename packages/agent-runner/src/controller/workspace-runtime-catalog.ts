import fs from 'node:fs';
import path from 'node:path';
import type { CatalogPack, WorkspaceRecipe, ToolchainPackRef, RuntimeCatalog } from '../types';

const MAX_CATALOG_RECIPES = 256;
const MAX_CATALOG_PACKS = 4096;
const MAX_CATALOG_STRING_BYTES = 16 * 1024;

type UnknownRecord = Record<string, unknown>;

const invalidCatalog = (): never => {
  throw new Error('CATALOG_INVALID');
};

const recordValue = (value: unknown): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidCatalog();
  return value as UnknownRecord;
};

const stringValue = (value: unknown): string => {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > MAX_CATALOG_STRING_BYTES)
    return invalidCatalog();
  return value;
};

const integerValue = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return invalidCatalog();
  return Number(value);
};

const stringArrayValue = (value: unknown, maxItems = 256): string[] => {
  if (!Array.isArray(value) || value.length > maxItems) return invalidCatalog();
  return value.map(stringValue);
};

const stringRecordValue = (value: unknown, maxItems = 64): Record<string, string> => {
  const record = recordValue(value);
  const entries = Object.entries(record);
  if (entries.length > maxItems) return invalidCatalog();
  return Object.fromEntries(entries.map(([key, item]) => [stringValue(key), stringValue(item)]));
};

const decodeRecipe = (value: unknown): WorkspaceRecipe => {
  const record = recordValue(value);
  if (!['shell', 'code', 'data', 'browser'].includes(String(record.kind))) return invalidCatalog();
  return {
    id: stringValue(record.id),
    revision: stringValue(record.revision),
    kind: record.kind as WorkspaceRecipe['kind'],
    displayName: stringValue(record.displayName),
    allowedFamilies: stringArrayValue(record.allowedFamilies),
    defaultFamilies: stringArrayValue(record.defaultFamilies),
  };
};

const decodePack = (value: unknown): CatalogPack => {
  const record = recordValue(value);
  if (record.schemaVersion !== 1 || !['supported', 'deprecated', 'unavailable'].includes(String(record.status)))
    return invalidCatalog();
  if (!Array.isArray(record.dependencies) || record.dependencies.length > 256) return invalidCatalog();
  return {
    schemaVersion: 1,
    familyId: stringValue(record.familyId),
    versionId: stringValue(record.versionId),
    displayName: stringValue(record.displayName),
    contentDigestByArch: stringRecordValue(record.contentDigestByArch),
    downloadRefByArch: stringRecordValue(record.downloadRefByArch),
    capabilities: stringArrayValue(record.capabilities, 512),
    runnerApiRange: stringValue(record.runnerApiRange),
    diskBytes: integerValue(record.diskBytes),
    dependencies: record.dependencies.map((item) => {
      const dependency = recordValue(item);
      return { familyId: stringValue(dependency.familyId), versionId: stringValue(dependency.versionId) };
    }),
    supportedArchitectures: stringArrayValue(record.supportedArchitectures, 64),
    status: record.status as CatalogPack['status'],
  };
};

const decodeRuntimeCatalog = (value: unknown): RuntimeCatalog => {
  const record = recordValue(value);
  if (record.schemaVersion !== 1) return invalidCatalog();
  if (!Array.isArray(record.recipes) || record.recipes.length > MAX_CATALOG_RECIPES) return invalidCatalog();
  if (!Array.isArray(record.packs) || record.packs.length > MAX_CATALOG_PACKS) return invalidCatalog();
  return {
    schemaVersion: 1,
    revision: stringValue(record.revision),
    runtimeDigest: stringValue(record.runtimeDigest),
    recipes: record.recipes.map(decodeRecipe),
    packs: record.packs.map(decodePack),
  };
};

export class WorkspaceRuntimeCatalog {
  private cached: RuntimeCatalog | null = null;
  constructor(private readonly catalogFile: string) {}

  load(): RuntimeCatalog {
    if (this.cached) return this.cached;
    let parsed: RuntimeCatalog;
    try {
      parsed = decodeRuntimeCatalog(JSON.parse(fs.readFileSync(this.catalogFile, 'utf8')) as unknown);
    } catch {
      throw new Error('CATALOG_INVALID');
    }
    this.cached = parsed;
    return parsed;
  }

  recipe(id: string): WorkspaceRecipe {
    const recipe = this.load().recipes.find((candidate) => candidate.id === id);
    if (!recipe) throw new Error('WORKSPACE_RECIPE_UNAVAILABLE');
    return recipe;
  }

  pack(familyId: string, versionId: string): CatalogPack {
    const pack = this.load().packs.find(
      (candidate) => candidate.familyId === familyId && candidate.versionId === versionId,
    );
    if (!pack || pack.status === 'unavailable') throw new Error('WORKSPACE_TOOLCHAIN_UNAVAILABLE');
    return pack;
  }

  validateSelection(recipeId: string, refs: readonly ToolchainPackRef[]): void {
    const recipe = this.recipe(recipeId);
    if (!refs.length || refs.length > 32) throw new Error('WORKSPACE_TOOLCHAIN_UNAVAILABLE');
    const seen = new Set<string>();
    for (const ref of refs) {
      if (!recipe.allowedFamilies.includes(ref.familyId) || seen.has(ref.familyId)) {
        throw new Error('WORKSPACE_TOOLCHAIN_UNAVAILABLE');
      }
      seen.add(ref.familyId);
      const pack = this.pack(ref.familyId, ref.versionId);
      const digest = pack.contentDigestByArch[process.arch];
      if (
        pack.status !== 'supported' ||
        !pack.supportedArchitectures.includes(process.arch) ||
        !digest ||
        digest !== ref.contentDigest
      ) {
        throw new Error('WORKSPACE_TOOLCHAIN_UNAVAILABLE');
      }
    }
    if (recipe.defaultFamilies.some((familyId) => !seen.has(familyId))) {
      throw new Error('WORKSPACE_TOOLCHAIN_UNAVAILABLE');
    }
  }

  catalogPath(...parts: string[]): string {
    return path.join(path.dirname(this.catalogFile), ...parts);
  }
}
