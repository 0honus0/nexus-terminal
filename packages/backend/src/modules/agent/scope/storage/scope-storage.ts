import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { StoredGrant } from '../../governance/storage/governance-storage.js';

export interface StoredDefinition {
	id: string;
	version: string;
	contentHash: string;
	displayName: string;
	capabilities: AgentCapability[];
	defaultEnabled: boolean;
}

export interface CreateAppRecord {
	id: string;
	userId: number;
	name: string;
	definitionId: string;
	definitionVersion: string;
	enabled: boolean;
	isDefault: boolean;
	grants: StoredGrant[];
	now: number;
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
	installDefinitions(
		definitions: StoredDefinition[],
		now: () => number,
		decide: (current: StoredAppInstallationFact) => StoredAppInstallationTask,
	): Promise<void>;
	createApp(command: CreateAppRecord): Promise<AppRecord>;
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

export interface StoredAppInstallationFact {
	definitionId: string;
	definitionVersion: string;
	enabled: boolean;
}

export interface StoredAppInstallationTask {
	definitionVersion: string;
	enabled: boolean;
	invalidate: boolean;
}
