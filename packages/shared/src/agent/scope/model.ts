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
	messageOrdinal: number;
	chunkIndex: number;
	textOffset: number;
}

export interface AgentThreadEntry {
	runId: string;
	operationSequence: number;
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

/** Backward page whose body is still ordered for the ordinary forward stream. */
export interface AgentThreadEntryHistory {
	body: AgentThreadEntries;
	startCursor: AgentThreadEntryCursor;
	hasEarlier: boolean;
}
