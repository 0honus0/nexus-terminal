export interface AgentDefinitionView {
  id: string;
  version: string;
  displayName: string;
  description: string;
  requiredModelCapabilities: string[];
}

export interface AgentDefinitionRegistryPort {
  list(appId: string, appVersion: string): readonly AgentDefinitionView[];
  require(appId: string, appVersion: string, definitionId: string): AgentDefinitionView;
}
