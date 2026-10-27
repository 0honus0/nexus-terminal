import type { AgentExecutionLimits, AgentExecutionSettingsView, AgentHardLimitPreviewView } from './model.js';

export interface AgentExecutionSettingsUpdate {
	expectedVersion: number;
	enabled: boolean;
	limits: AgentExecutionLimits;
}

export interface AgentHardLimitPreviewRequest {
	expectedVersion: number;
	proposed: AgentExecutionLimits;
}

export interface AgentHardLimitConfirmRequest {
	confirmationId: string;
}

export interface AgentExecutionSettingsResponse {
	settings: AgentExecutionSettingsView;
}

export interface AgentHardLimitPreviewResponse {
	confirmation: AgentHardLimitPreviewView;
}
