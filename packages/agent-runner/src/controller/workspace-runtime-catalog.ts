import fs from 'node:fs';
import path from 'node:path';
import type { CatalogPack, WorkspaceRecipe, ToolchainPackRef, RuntimeCatalog } from '../types';

export class WorkspaceRuntimeCatalog {
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
