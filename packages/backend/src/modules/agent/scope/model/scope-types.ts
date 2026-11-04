import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';

export interface AgentApp {
	definitionInstalled: boolean;
	id: string;
	name: string;
	definitionId: string;
	definitionVersion: string;
	capabilities: AgentCapability[];
	enabled: boolean;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface AppStateTask {
	enabled: boolean;
	invalidate: boolean;
}

export interface AgentThread {
	id: string;
	appId: string;
	title: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface AppDeclaration {
	id: string;
	version: string;
	displayName: string;
	capabilities: AgentCapability[];
}
