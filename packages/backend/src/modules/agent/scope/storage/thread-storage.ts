import type { ThreadRecord } from './scope-storage.js';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';

export interface StoredThreadAccess {
	kind: 'plugin' | 'session';
	userId: number;
	appId: string;
	digest: string;
}

export interface StoredPluginThreadAccessFacts {
	kind: 'plugin';
	identityUserId: number | null;
	revision: number;
	installed: boolean;
	enabled: boolean;
	trusted: boolean;
}

export type StoredThreadAccessFacts =
	| StoredPluginThreadAccessFacts
	| {
			kind: 'session';
			identityUserId: number | null;
			app: { version: number; enabled: boolean; declared: boolean } | null;
	  };

export type StoredThreadMutation =
	| { kind: 'create'; operationId: string; title: string; requestHash: string; now: number }
	| {
			kind: 'rename';
			operationId: string;
			threadId: string;
			expectedVersion: number;
			title: string;
			requestHash: string;
			now: number;
	  };

export interface StoredThreadRemoval {
	threadId: string;
	expectedVersion: number;
}

export interface StoredThreadRemovalFacts {
	runStatuses: AgentRunStatus[];
	maxMemoryVersion: number | null;
}

export interface StoredThreadRemovalDecision {
	updatedAt: number;
}

export class ThreadStorageRefusal extends Error {
	constructor(readonly code: 'not_found' | 'version_conflict' | 'idempotency_conflict') {
		super(code);
	}
}

export interface ThreadStorage {
	withAdmission<T>(
		access: StoredThreadAccess,
		admit: (facts: StoredThreadAccessFacts) => void,
		work: () => Promise<T>,
	): Promise<T>;
	list(
		access: StoredThreadAccess,
		after: string | null,
		limit: number,
		admit: (facts: StoredThreadAccessFacts) => void,
	): Promise<ThreadRecord[]>;
	mutate(
		access: StoredThreadAccess,
		input: StoredThreadMutation,
		admit: (facts: StoredThreadAccessFacts) => void,
		admitCapacity: (threads: number, commands: number) => void,
	): Promise<ThreadRecord>;
	remove(
		access: StoredThreadAccess,
		input: StoredThreadRemoval,
		admit: (facts: StoredThreadAccessFacts) => void,
		admitRemoval: (facts: StoredThreadRemovalFacts) => StoredThreadRemovalDecision,
	): Promise<ThreadRecord>;
}
