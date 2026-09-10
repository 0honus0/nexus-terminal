import { compare } from 'semver';
import type { AgentAppDefinition } from './app.types';

export class AppRegistryService {
  private readonly builtinDefinitions = new Map<string, AgentAppDefinition>();
  private readonly versions = new Map<string, Map<string, AgentAppDefinition>>();
  private readonly intentOwners = new Map<string, string>();

  register(definition: AgentAppDefinition): void {
    const { id } = definition.manifest;
    if (this.builtinDefinitions.has(id)) throw new Error(`Duplicate Agent App id: ${id}`);
    this.assertIntentsAvailable(definition, id);
    this.builtinDefinitions.set(id, definition);
    this.putVersion(definition);
  }

  registerVersion(definition: AgentAppDefinition): void {
    const { id, version } = definition.manifest;
    const existing = this.versions.get(id)?.get(version);
    if (existing) {
      if (JSON.stringify(existing.manifest) !== JSON.stringify(definition.manifest)) {
        throw new Error(`Conflicting Agent App version: ${id}@${version}`);
      }
      return;
    }
    this.assertIntentsAvailable(definition, id);
    this.putVersion(definition);
  }

  get(appId: string, version?: string): AgentAppDefinition {
    const definition = version
      ? this.versions.get(appId)?.get(version)
      : (this.builtinDefinitions.get(appId) ?? this.latestVersion(appId));
    if (!definition) throw new Error(`Agent App not registered: ${appId}${version ? `@${version}` : ''}`);
    return definition;
  }

  has(appId: string, version?: string): boolean {
    return version ? Boolean(this.versions.get(appId)?.has(version)) : Boolean(this.versions.get(appId)?.size);
  }

  isBuiltin(appId: string): boolean {
    return this.builtinDefinitions.has(appId);
  }

  list(): AgentAppDefinition[] {
    return [...this.builtinDefinitions.values()].sort((left, right) =>
      left.manifest.id.localeCompare(right.manifest.id),
    );
  }

  private putVersion(definition: AgentAppDefinition): void {
    const { id, version, intents } = definition.manifest;
    const versions = this.versions.get(id) ?? new Map<string, AgentAppDefinition>();
    versions.set(version, definition);
    this.versions.set(id, versions);
    for (const intent of intents) this.intentOwners.set(intent.id, id);
  }

  private latestVersion(appId: string): AgentAppDefinition | undefined {
    const versions = [...(this.versions.get(appId)?.values() ?? [])];
    return versions.sort((left, right) => compare(right.manifest.version, left.manifest.version))[0];
  }

  private assertIntentsAvailable(definition: AgentAppDefinition, appId: string): void {
    for (const intent of definition.manifest.intents) {
      const owner = this.intentOwners.get(intent.id);
      if (owner && owner !== appId) throw new Error(`Duplicate Agent intent ${intent.id}: already owned by ${owner}`);
    }
  }
}
