import type { AgentThread } from './scope-types.js';

export interface ThreadAccess {
	userId: number;
	appId: string;
	token: string;
	revision: number;
	expiresAt: number;
	assertCurrent(): void;
}

export interface ThreadPage {
	items: AgentThread[];
	nextCursor: string | null;
}

export type ThreadMutation =
	| { kind: 'create'; operationId: string; title: string }
	| { kind: 'rename'; operationId: string; threadId: string; expectedVersion: number; title: string };

export interface ThreadAccessFacts {
	identityUserId: number | null;
	revision: number;
	installed: boolean;
	enabled: boolean;
	trusted: boolean;
}
