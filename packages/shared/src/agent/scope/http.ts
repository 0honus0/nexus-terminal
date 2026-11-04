import type { AgentAppView, AgentThreadView } from './model.js';

export interface AgentCreateThreadRequest {
	title: string;
}

export interface AgentAppPath {
	appId: string;
}

export type AgentCreateThreadResponse = AgentThreadView;

export interface AgentAppStateUpdateRequest {
	enabled: boolean;
	expectedVersion: number;
}

export type AgentAppListResponse = AgentAppView[];

export type AgentAppDefinitionListResponse = import('./model.js').AgentAppDefinitionView[];
