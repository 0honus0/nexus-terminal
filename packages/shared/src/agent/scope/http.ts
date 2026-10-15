import type { AgentAppView, AgentThreadView } from './model.js';

export interface AgentCreateAppRequest {
	name: string;
	definitionId?: string;
}

export interface AgentCreateThreadRequest {
	title: string;
}

export interface AgentAppPath {
	appId: string;
}

export type AgentCreateAppResponse = AgentAppView;

export type AgentCreateThreadResponse = AgentThreadView;

export interface AgentAppStateUpdateRequest {
	enabled: boolean;
	expectedVersion: number;
}

export type AgentAppListResponse = AgentAppView[];

export type AgentAppDefinitionListResponse = import('./model.js').AgentAppDefinitionView[];
