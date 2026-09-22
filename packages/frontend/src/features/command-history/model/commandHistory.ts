import type { CommandHistoryEntryDto } from '@nexus-terminal/protocol/command-history';

export type CommandHistoryEntry = CommandHistoryEntryDto;

export interface ExecuteHistoryIntent {
  command: string;
  allSessions?: boolean;
}
