import type { AgentDefinitionView } from '../../runtime/definitions/agent-definition.port';

export const OPERATIONS_AGENT_DEFINITIONS: readonly AgentDefinitionView[] = [
  {
    id: 'operations.default',
    version: '1.0.0',
    displayName: 'Operations Agent',
    description:
      'Operations assistant whose available actions are resolved from current capability grants and Tool Catalog.',
    requiredModelCapabilities: ['streaming'],
  },
] as const;

export const requireOperationsAgentDefinition = (id: string): AgentDefinitionView => {
  const definition = OPERATIONS_AGENT_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!definition) throw new Error('AGENT_DEFINITION_NOT_FOUND');
  return definition;
};
