import type { ThreadRecord } from './scope-storage.js';

export interface StoredThreadAccess {
	userId: number;
	appId: string;
	digest: string;
}

export interface StoredThreadAccessFacts {
	identityUserId: number | null;
	revision: number;
	installed: boolean;
	enabled: boolean;
	trusted: boolean;
}

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

export class ThreadStorageRefusal extends Error {
	constructor(readonly code: 'not_found' | 'version_conflict' | 'idempotency_conflict') {
		super(code);
	}
}

export interface ThreadStorage {
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
}
