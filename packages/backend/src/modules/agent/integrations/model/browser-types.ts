export interface BrowserEndpoint {
	url: string;
	priority: number;
	allowPlaintext: boolean;
	verifyTls: boolean;
}

export interface BrowserTarget {
	id: string;
	endpoints: BrowserEndpoint[];
	allowedUrlPatterns: string[];
}

export interface BrowserConfiguration {
	version: number;
	targets: BrowserTarget[];
}

export interface BrowserActor {
	userId: number;
	token: string;
}

export interface BrowserOwner {
	userId: number;
	appId: string;
	runId: string;
}

export interface BrowserToolOwner {
	userId: number;
	appId: string;
	runId: string;
	operationId: string;
	operationHash: string;
}

export interface BrowserSessionRecord {
	sessionId: string;
	targetId: string;
	targetVersion: number;
	runId: string;
	createdAt: number;
}

export interface BrowserSnapshot {
	snapshotId: string;
	url: string;
	title: string;
	nodes: {
		ref: string;
		parentRef: string | null;
		tag: string;
		text: string;
		attributes: { name: string; value: string }[];
	}[];
	truncated: boolean;
}

export type BrowserInput =
	| { action: 'open'; targetId: string; expectedVersion: number }
	| { action: 'close'; sessionId: string }
	| { action: 'snapshot'; sessionId: string; maxNodes: number }
	| { action: 'screenshot'; sessionId: string }
	| { action: 'console'; sessionId: string; after: number; limit: number }
	| { action: 'navigate'; settleMs: number; sessionId: string; url: string }
	| { action: 'back'; settleMs: number; sessionId: string }
	| { action: 'scroll'; settleMs: number; sessionId: string; deltaX: number; deltaY: number }
	| {
			action: 'press';
			settleMs: number;
			sessionId: string;
			key: string;
			focus: { snapshotId: string; nodeRef: string } | null;
			modifiers: ('Alt' | 'Control' | 'Meta' | 'Shift')[];
	  }
	| { action: 'select'; settleMs: number; sessionId: string; snapshotId: string; nodeRef: string; values: string[] }
	| { action: 'wait'; sessionId: string; mode: 'timeout' | 'networkIdle'; maxMillis: number }
	| { action: 'click'; settleMs: number; sessionId: string; snapshotId: string; nodeRef: string }
	| { action: 'type'; settleMs: number; sessionId: string; snapshotId: string; nodeRef: string; text: string }
	| {
			action: 'upload';
			settleMs: number;
			sessionId: string;
			snapshotId: string;
			nodeRef: string;
			artifactId: string;
			expectedVersion: number;
			sha256: string;
	  }
	| { action: 'download'; sessionId: string; snapshotId: string; nodeRef: string; maxBytes: number };

export type BrowserReply =
	| { kind: 'page'; url: string; title: string }
	| { kind: 'file'; url: string; name: string; mediaType: string; bytes: Uint8Array };

export type BrowserSessionAction =
	| Exclude<BrowserInput, { action: 'open' | 'close' | 'snapshot' | 'screenshot' | 'console' | 'upload' }>
	| {
			action: 'upload';
			settleMs: number;
			sessionId: string;
			snapshotId: string;
			nodeRef: string;
			name: string;
			mediaType: string;
			bytes: Uint8Array;
	  };

/** Application resource capability: no CDP/Page/Browser object leaves this Model. */
export interface BrowserApplicationSession {
	readonly maxUploadBytes: number;
	snapshot(maxNodes: number, signal: AbortSignal): Promise<BrowserSnapshot>;
	screenshot(maxBytes: number, signal: AbortSignal): Promise<Uint8Array>;
	console(
		after: number,
		limit: number,
	): { entries: { sequence: number; type: string; text: string }[]; nextCursor: number; truncated: boolean };
	perform(input: BrowserSessionAction, signal: AbortSignal): Promise<BrowserReply>;
	close(): Promise<void>;
}
