import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { GrantInput } from '../../governance/model/governance-types.js';

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

export interface AppDefinition {
	id: string;
	version: string;
	displayName: string;
	capabilities: AgentCapability[];
	defaultEnabled: boolean;
	defaultGrants: GrantInput[];
}

export interface CreateApp {
	id: string;
	userId: number;
	name: string;
	definition: AppDefinition;
	isDefault: boolean;
	now: number;
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

export interface AppInstallationFact {
	definitionId: string;
	definitionVersion: string;
	enabled: boolean;
}

export interface AppInstallationTask {
	definitionVersion: string;
	enabled: boolean;
	invalidate: boolean;
}

export interface AppDeclaration {
	id: string;
	version: string;
	displayName: string;
	capabilities: AgentCapability[];
	defaultEnabled: boolean;
}
