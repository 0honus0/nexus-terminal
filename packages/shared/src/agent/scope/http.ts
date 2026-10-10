import type { AgentAppView, AgentThreadView } from './model.js';

export interface AgentCreateAppRequest {
	name: string;
}

export interface AgentCreateThreadRequest {
	title: string;
}

export interface AgentAppPath {
	appId: string;
}

export type AgentCreateAppResponse = AgentAppView;

export type AgentCreateThreadResponse = AgentThreadView;
