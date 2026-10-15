export interface BrowserConnect {
	endpoint: string;
	verifyTls: boolean;
	allowUrl(url: string): boolean;
}

export interface BrowserNode {
	ref: string;
	parentRef: string | null;
	tag: string;
	text: string;
	attributes: { name: string; value: string }[];
}

export interface BrowserSnapshot {
	snapshotId: string;
	url: string;
	title: string;
	nodes: BrowserNode[];
	truncated: boolean;
}

export type BrowserAction =
	| { kind: 'navigate'; settleMs: number; url: string }
	| { kind: 'back'; settleMs: number }
	| { kind: 'scroll'; settleMs: number; deltaX: number; deltaY: number }
	| {
			kind: 'press';
			settleMs: number;
			focus: { snapshotId: string; nodeRef: string } | null;
			key: string;
			modifiers: ('Alt' | 'Control' | 'Meta' | 'Shift')[];
	  }
	| { kind: 'select'; settleMs: number; snapshotId: string; nodeRef: string; values: string[] }
	| { kind: 'wait'; mode: 'timeout' | 'networkIdle'; maxMillis: number }
	| { kind: 'click'; settleMs: number; snapshotId: string; nodeRef: string }
	| { kind: 'type'; settleMs: number; snapshotId: string; nodeRef: string; text: string }
	| {
			kind: 'upload';
			settleMs: number;
			snapshotId: string;
			nodeRef: string;
			name: string;
			mediaType: string;
			bytes: Uint8Array;
	  }
	| { kind: 'download'; snapshotId: string; nodeRef: string; maxBytes: number };

export type BrowserActionResult =
	| { kind: 'page'; url: string; title: string }
	| { kind: 'file'; url: string; name: string; mediaType: string; bytes: Uint8Array };

export interface BrowserSession {
	snapshot(maxNodes: number, signal: AbortSignal): Promise<BrowserSnapshot>;
	screenshot(maxBytes: number, signal: AbortSignal): Promise<Uint8Array>;
	console(
		after: number,
		limit: number,
	): { entries: { sequence: number; type: string; text: string }[]; nextCursor: number; truncated: boolean };
	perform(action: BrowserAction, signal: AbortSignal): Promise<BrowserActionResult>;
	close(): Promise<void>;
}

export interface BrowserClient {
	connect(options: BrowserConnect, signal: AbortSignal): Promise<BrowserSession>;
}

export class BrowserFailure extends Error {
	constructor(
		readonly kind:
			'unavailable' | 'stale_snapshot' | 'url_denied' | 'limit_exceeded' | 'execution_unknown' | 'cleanup_failed',
		options?: ErrorOptions,
	) {
		super(kind, options);
		this.name = 'BrowserFailure';
	}
}
