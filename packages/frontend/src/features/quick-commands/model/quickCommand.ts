import type {
  QuickCommandDto,
  QuickCommandMutationRequestDto,
  QuickCommandTagDto,
} from '@nexus-terminal/protocol/quick-commands';

export type QuickCommandTag = QuickCommandTagDto;
export type QuickCommand = QuickCommandDto;
export type QuickCommandInput = QuickCommandMutationRequestDto;
export interface QuickCommandGroup {
  id: number | null;
  name: string;
  commands: QuickCommand[];
}
export type QuickCommandSort = 'name' | 'usageCount' | 'lastUsed';
export interface QuickCommandExpansion {
  command: string;
  unresolvedVariables: string[];
}
export interface ExecuteCommandIntent {
  command: string;
  sourceId?: number;
  allSessions?: boolean;
}

export function expandQuickCommand(template: string, variables: Record<string, string>): QuickCommandExpansion {
  let command = template;
  for (const [name, value] of Object.entries(variables)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    command = command.replace(new RegExp(`\\$\\{${escaped}\\}`, 'g'), () => value);
  }
  const unresolvedVariables = [...command.matchAll(/\$\{([^}]+)\}/g)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name));
  return { command, unresolvedVariables: [...new Set(unresolvedVariables)] };
}
