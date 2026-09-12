import type { AgentDefinitionRegistryPort, AgentDefinitionView } from './agent-definition.port';

export class AgentDefinitionRegistry implements AgentDefinitionRegistryPort {
  private readonly definitions = new Map<string, Map<string, Map<string, AgentDefinitionView>>>();

  register(appId: string, appVersion: string, definition: AgentDefinitionView): void {
    let appVersions = this.definitions.get(appId);
    if (!appVersions) {
      appVersions = new Map();
      this.definitions.set(appId, appVersions);
    }
    let appDefinitions = appVersions.get(appVersion);
    if (!appDefinitions) {
      appDefinitions = new Map();
      appVersions.set(appVersion, appDefinitions);
    }
    const existing = appDefinitions.get(definition.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(definition)) {
        throw new Error(`Conflicting Agent definition: ${appId}@${appVersion}/${definition.id}`);
      }
      return;
    }
    appDefinitions.set(definition.id, this.clone(definition));
  }

  replaceVersion(appId: string, appVersion: string, definitions: readonly AgentDefinitionView[]): void {
    const next = new Map<string, AgentDefinitionView>();
    for (const definition of definitions) {
      if (next.has(definition.id))
        throw new Error(`Duplicate Agent definition: ${appId}@${appVersion}/${definition.id}`);
      next.set(definition.id, this.clone(definition));
    }
    const appVersions = this.definitions.get(appId) ?? new Map<string, Map<string, AgentDefinitionView>>();
    appVersions.set(appVersion, next);
    this.definitions.set(appId, appVersions);
  }

  removeVersion(appId: string, appVersion: string): void {
    const appVersions = this.definitions.get(appId);
    if (!appVersions) return;
    appVersions.delete(appVersion);
    if (appVersions.size === 0) this.definitions.delete(appId);
  }

  list(appId: string, appVersion: string): readonly AgentDefinitionView[] {
    return [...(this.definitions.get(appId)?.get(appVersion)?.values() ?? [])].map((definition) =>
      this.clone(definition),
    );
  }

  require(appId: string, appVersion: string, definitionId: string): AgentDefinitionView {
    const definition = this.definitions.get(appId)?.get(appVersion)?.get(definitionId);
    if (!definition) throw new Error('AGENT_DEFINITION_NOT_FOUND');
    return this.clone(definition);
  }

  private clone(definition: AgentDefinitionView): AgentDefinitionView {
    return { ...definition, requiredModelCapabilities: [...definition.requiredModelCapabilities] };
  }
}
