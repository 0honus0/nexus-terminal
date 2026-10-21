import type { AgentThread } from './scope-types.js';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';

export interface PluginThreadAccess {
	kind: 'plugin';
	userId: number;
	appId: string;
	token: string;
	revision: number;
	expiresAt: number;
	assertCurrent(): void;
}

export interface SessionThreadAccess {
	kind: 'session';
	userId: number;
	appId: string;
	token: string;
	appVersion: number;
	assertCurrent(): void;
}

export type ThreadAccess = PluginThreadAccess | SessionThreadAccess;

export interface ThreadPage {
	items: AgentThread[];
	nextCursor: string | null;
}

export type ThreadMutation =
	| { kind: 'create'; operationId: string; title: string }
	| { kind: 'rename'; operationId: string; threadId: string; expectedVersion: number; title: string };

export interface ThreadRemoval {
	threadId: string;
	expectedVersion: number;
}

export interface ThreadRemovalFacts {
	runStatuses: AgentRunStatus[];
	maxMemoryVersion: number | null;
}

export interface ThreadRemovalDecision {
	updatedAt: number;
}

export interface PluginThreadAccessFacts {
	kind: 'plugin';
	identityUserId: number | null;
	revision: number;
	installed: boolean;
	enabled: boolean;
	trusted: boolean;
}

export type ThreadAccessFacts =
	| PluginThreadAccessFacts
	| {
			kind: 'session';
			identityUserId: number | null;
			app: { version: number; enabled: boolean; declared: boolean } | null;
	  };
