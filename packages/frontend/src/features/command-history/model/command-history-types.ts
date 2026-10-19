import type { ComputedRef } from 'vue';

export interface CommandHistoryItem {
	id: number;
	command: string;
	timestamp: number;
}

export interface ExecuteHistoryIntent {
	command: string;
	allSessions?: boolean;
}

export interface CommandHistoryController {
	selected: ComputedRef<Readonly<CommandHistoryItem> | null>;
	load(): Promise<void>;
	add(command: string, permission?: AbortSignal): Promise<void>;
	setSearch(value: string): void;
	selectNext(): void;
	selectPrevious(): void;
	resetSelection(): void;
}
