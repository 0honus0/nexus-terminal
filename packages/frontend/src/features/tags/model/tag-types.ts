import type { ComputedRef } from 'vue';

export interface TagSummary {
	id: number;
	name: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface ConnectionTagsController {
	tags: ComputedRef<TagSummary[]>;
	loaded: ComputedRef<boolean>;
	busy: ComputedRef<boolean>;
	needsRefresh: ComputedRef<boolean>;
	load(force?: boolean): Promise<TagSummary[]>;
	revalidate(maxAgeMs?: number): Promise<TagSummary[]>;
	create(name: string, signal?: AbortSignal): Promise<TagSummary>;
	rename(snapshot: TagSummary, name: string, signal?: AbortSignal): Promise<TagSummary>;
	remove(id: number, signal?: AbortSignal): Promise<void>;
	ensure(names: string[], signal?: AbortSignal): Promise<TagSummary[]>;
	setConnections(id: number, connectionIds: number[], signal?: AbortSignal): Promise<void>;
}
