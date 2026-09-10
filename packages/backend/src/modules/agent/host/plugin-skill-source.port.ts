import type { Scope } from '../agent.types';
import type { AgentCapability } from './app.types';

export interface PluginSkillDocument {
  path: string;
  content: string;
  sha256: string;
}

export interface PluginSkillBundle {
  appId: string;
  version: string;
  packageHash: string;
  capabilities: AgentCapability[];
  documents: PluginSkillDocument[];
}

export interface PluginSkillSourcePort {
  load(scope: Scope): Promise<PluginSkillBundle | null>;
}
