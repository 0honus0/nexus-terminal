import type { CommandHistoryEntry } from '@nexus-terminal/shared/preferences/history/model';
import type { CommandHistoryItem } from './command-history-types';

export function fromCommandHistory(entry: CommandHistoryEntry): CommandHistoryItem {
	return { id: entry.id, command: entry.command, timestamp: entry.timestamp };
}
