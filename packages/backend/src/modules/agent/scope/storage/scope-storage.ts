import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';

export interface StoredDefinition {
	userId: number;
	sourcePackageId: string;
	/** Immutable internal execution composition identity. */
	id: string;
	version: string;
	contentHash: string;
	displayName: string;
	capabilities: AgentCapability[];
}

/** Signed source App package metadata for the public package catalog. */
export interface StoredAppPackageDeclaration {
	sourcePackageId: string;
	version: string;
	displayName: string;
	capabilities: AgentCapability[];
}

export interface AppRecord {
	sourcePackageId: string;
	definitionInstalled: boolean;
	id: string;
	userId: number;
	name: string;
	/** Internal declaration identity; sourcePackageId is projected to clients separately. */
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
	listDeclarations(userId: number): Promise<StoredAppPackageDeclaration[]>;
	getApp(userId: number, id: string): Promise<AppRecord | null>;
	listApps(userId: number): Promise<AppRecord[]>;
	setEnabled(
		userId: number,
		id: string,
		version: number,
		now: () => number,
		decide: (current: AppRecord) => { enabled: boolean; invalidate: boolean },
	): Promise<AppRecord | 'not_found' | 'version_conflict'>;
	createThread(command: CreateThreadRecord, admitCapacity: (threads: number) => void): Promise<ThreadRecord | null>;
}
