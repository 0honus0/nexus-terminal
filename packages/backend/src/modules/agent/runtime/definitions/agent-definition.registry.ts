import type { AgentDefinitionRegistryPort, AgentDefinitionView } from './agent-definition.port';

export class AgentDefinitionRegistry implements AgentDefinitionRegistryPort {
  private readonly definitions = new Map<string, Map<string, AgentDefinitionView>>();

  register(appId: string, definition: AgentDefinitionView): void {
    let appDefinitions = this.definitions.get(appId);
    if (!appDefinitions) {
      appDefinitions = new Map();
      this.definitions.set(appId, appDefinitions);
    }
    if (appDefinitions.has(definition.id)) throw new Error(`Duplicate Agent definition: ${appId}/${definition.id}`);
    appDefinitions.set(definition.id, {
      ...definition,
      requiredModelCapabilities: [...definition.requiredModelCapabilities],
    });
  }

  list(appId: string): readonly AgentDefinitionView[] {
    return [...(this.definitions.get(appId)?.values() ?? [])].map((definition) => ({
      ...definition,
      requiredModelCapabilities: [...definition.requiredModelCapabilities],
    }));
  }

  require(appId: string, definitionId: string): AgentDefinitionView {
    const definition = this.definitions.get(appId)?.get(definitionId);
    if (!definition) throw new Error('AGENT_DEFINITION_NOT_FOUND');
    return { ...definition, requiredModelCapabilities: [...definition.requiredModelCapabilities] };
  }
}
