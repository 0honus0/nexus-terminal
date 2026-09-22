import type { CommandHistoryEntryDto } from '@nexus-terminal/protocol/command-history';
export type { CommandHistoryEntryDto };

export interface ExecuteHistoryIntent {
  command: string;
  allSessions?: boolean;
}
