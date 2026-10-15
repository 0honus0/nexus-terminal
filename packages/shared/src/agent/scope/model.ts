import type { AgentAppExecutionState } from './values.js';
import type { AgentCapability } from '../governance/values.js';

export interface AgentAppView {
	id: string;
	name: string;
	definitionId: string;
	definitionVersion: string;
	capabilities: AgentCapability[];
	enabled: boolean;
	version: number;
	executionState: AgentAppExecutionState;
	createdAt: number;
	updatedAt: number;
}

export interface AgentAppDefinitionView {
	id: string;
	version: string;
	displayName: string;
	capabilities: AgentCapability[];
	defaultEnabled: boolean;
}

export interface AgentThreadView {
	id: string;
	appId: string;
	title: string;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface AgentThreadEntryCursor {
	runSequence: number;
	stepIndex: number;
	eventSequence: number;
	textOffset: number;
}

export interface AgentThreadEntry {
	runId: string;
	role: 'user' | 'assistant';
	position: AgentThreadEntryCursor;
	text: string;
}

export interface AgentThreadEntries {
	appId: string;
	threadId: string;
	items: AgentThreadEntry[];
	nextCursor: AgentThreadEntryCursor;
}
