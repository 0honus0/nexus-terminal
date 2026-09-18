import type { AgentModelCapability } from '../../ai/model.types';

export interface AgentDefinitionView {
  id: string;
  version: string;
  displayName: string;
  description: string;
  requiredModelCapabilities: AgentModelCapability[];
}

export interface AgentDefinitionModelCompatibility {
  providerId: string;
  modelId: string;
  configurationVersion: number;
  compatible: boolean;
  missingCapabilities: AgentModelCapability[];
}

export interface AgentDefinitionSelectionView extends AgentDefinitionView {
  modelCompatibility: AgentDefinitionModelCompatibility[];
}

export interface AgentDefinitionRegistryPort {
  list(appId: string, appVersion: string): readonly AgentDefinitionView[];
  require(appId: string, appVersion: string, definitionId: string): AgentDefinitionView;
}
