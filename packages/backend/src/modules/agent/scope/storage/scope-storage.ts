import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';

export interface StoredDefinition {
	id: string;
	version: string;
	contentHash: string;
	displayName: string;
	capabilities: AgentCapability[];
}

export interface AppRecord {
	definitionInstalled: boolean;
	id: string;
	userId: number;
	name: string;
	definitionId: string;
	definitionVersion: string;
	capabilities: AgentCapability[];
	enabled: boolean;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface StoredAppAuthority {
	enabled: boolean;
	declared: boolean;
	capabilities: AgentCapability[];
}

export interface CreateThreadRecord {
	id: string;
	userId: number;
	appId: string;
	title: string;
	createdAt: number;
}

export interface ThreadRecord {
	id: string;
	userId: number;
	appId: string;
	title: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface AgentScopeStorage {
	listDeclarations(userId: number, limit: number): Promise<StoredDefinition[]>;
	getApp(userId: number, id: string): Promise<AppRecord | null>;
	listApps(userId: number, limit: number): Promise<AppRecord[]>;
	setEnabled(
		userId: number,
		id: string,
		version: number,
		now: () => number,
		decide: (current: AppRecord) => { enabled: boolean; invalidate: boolean },
	): Promise<AppRecord | 'not_found' | 'version_conflict'>;
	createThread(command: CreateThreadRecord, admitCapacity: (threads: number) => void): Promise<ThreadRecord | null>;
}
