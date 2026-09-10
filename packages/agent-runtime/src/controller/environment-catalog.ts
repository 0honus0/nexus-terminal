import fs from 'node:fs';
import path from 'node:path';
import type { CatalogPack, EnvironmentRecipe, PackRef, RuntimeCatalog } from '../types';

export class EnvironmentCatalog {
  private cached: RuntimeCatalog | null = null;
  constructor(private readonly catalogFile: string) {}

  load(): RuntimeCatalog {
    if (this.cached) return this.cached;
    const parsed = JSON.parse(fs.readFileSync(this.catalogFile, 'utf8')) as RuntimeCatalog;
    if (parsed.schemaVersion !== 1 || !parsed.revision || !parsed.runtimeDigest) throw new Error('CATALOG_INVALID');
    if (!Array.isArray(parsed.recipes) || !Array.isArray(parsed.packs)) throw new Error('CATALOG_INVALID');
    this.cached = parsed;
    return parsed;
  }

  recipe(id: string): EnvironmentRecipe {
    const recipe = this.load().recipes.find((candidate) => candidate.id === id);
    if (!recipe) throw new Error('ENVIRONMENT_RECIPE_UNAVAILABLE');
    return recipe;
  }

  pack(familyId: string, versionId: string): CatalogPack {
    const pack = this.load().packs.find(
      (candidate) => candidate.familyId === familyId && candidate.versionId === versionId,
    );
    if (!pack || pack.status === 'unavailable') throw new Error('ENVIRONMENT_PACK_UNAVAILABLE');
    return pack;
  }

  resolve(recipeId: string, versions: Record<string, string> = {}): PackRef[] {
    const recipe = this.recipe(recipeId);
    const architecture = process.arch;
    return recipe.defaultFamilies.map((familyId) => {
      const candidates = this.load().packs.filter((pack) => pack.familyId === familyId && pack.status === 'supported');
      const selected = versions[familyId]
        ? this.pack(familyId, versions[familyId]!)
        : candidates.sort((a, b) => b.versionId.localeCompare(a.versionId, undefined, { numeric: true }))[0];
      if (!selected || !selected.supportedArchitectures.includes(architecture))
        throw new Error('ENVIRONMENT_PACK_UNAVAILABLE');
      const digest = selected.contentDigestByArch[architecture];
      if (!digest) throw new Error('ENVIRONMENT_PACK_UNAVAILABLE');
      return { familyId, versionId: selected.versionId, contentDigest: digest };
    });
  }

  catalogPath(...parts: string[]): string {
    return path.join(path.dirname(this.catalogFile), ...parts);
  }
}
