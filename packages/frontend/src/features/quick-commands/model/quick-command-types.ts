import type { ComputedRef } from 'vue';

export interface QuickCommandSummary {
	id: number;
	version: number;
	name: string | null;
	command: string;
	usageCount: number;
	variables: Record<string, string>;
	tagIds: number[];
	createdAt: number;
	updatedAt: number;
}

export interface QuickCommandTagSummary {
	id: number;
	version: number;
	name: string;
	createdAt: number;
	updatedAt: number;
}

export interface QuickCommandFormInput {
	name: string | null;
	command: string;
	variables: Record<string, string>;
	tagIds: number[];
}

export interface QuickCommandGroup {
	id: number | null;
	name: string;
	commands: QuickCommandSummary[];
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

export interface QuickCommandsController {
	selected: ComputedRef<Readonly<QuickCommandSummary> | null>;
	recordUsage(id: number): Promise<void>;
	setSearch(value: string): void;
	selectNext(grouped?: boolean): void;
	selectPrevious(grouped?: boolean): void;
	resetSelection(): void;
}

export type QuickCommandTagAssignment =
	{ tag: QuickCommandTagSummary; assigned: true } | { tag: QuickCommandTagSummary; assigned: false; error: unknown };
