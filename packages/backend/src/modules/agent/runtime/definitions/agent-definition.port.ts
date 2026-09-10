export interface AgentDefinitionView {
  id: string;
  version: string;
  displayName: string;
  description: string;
  requiredModelCapabilities: string[];
}

export interface AgentDefinitionRegistryPort {
  list(appId: string): readonly AgentDefinitionView[];
  require(appId: string, definitionId: string): AgentDefinitionView;
}
